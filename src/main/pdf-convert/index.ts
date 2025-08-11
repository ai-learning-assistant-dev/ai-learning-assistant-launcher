import path from 'node:path';
import { appPath, Exec } from '../exec';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { escape } from 'node:querystring';
import http from 'node:http';
import FormData from 'form-data';
import { dialog, IpcMain, BrowserWindow } from 'electron';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ActionName, ServiceName } from './type-info';
import { loggerFactory } from '../terminal-log';
import { getCurrentPdfConfig } from '../configs';
import { PDFDocument } from 'pdf-lib';

const exec = new Exec();
const channel = 'pdf-convert';

// 持久化状态管理
interface PdfFileItem {
  name: string;
  path: string;
  status?: 'pending' | 'converting' | 'success' | 'failed';
  error?: string;
  splitParts?: number; // 拆分份数
  currentSplitProgress?: number; // 当前拆分进度 (0-splitParts)
}

interface PdfConvertState {
  fileList: Array<PdfFileItem>;
  lastResult: any | null;
  backgroundTask: any | null;
}

let persistentState: PdfConvertState = {
  fileList: [],
  lastResult: null,
  backgroundTask: null
};

// 后台任务管理 - 单一任务
let backgroundTask: {
  taskId: string;
  filePaths: string[];
  startTime: number;
  status: 'running' | 'completed' | 'failed';
  result?: any;
} | null = null;

const pdfLogger = loggerFactory('PDF');

// PDF容器日志监控状态标记
let isPdfLoggingRunning = false;

async function startPdfContainerLogging() {
  // 检查是否已有日志监控在运行
  if (isPdfLoggingRunning) {
    console.debug('PDF容器日志监控已在运行中，跳过重复启动');
    return;
  }

  try {
    isPdfLoggingRunning = true;
    console.debug('开始启动PDF容器日志监控...');
    
    exec.exec('podman', ['logs', '-f', 'PDF'], {
      shell: true,
      encoding: 'utf8',
      logger: pdfLogger,
    }).catch(error => {
      console.debug('PDF容器日志监控结束:', error?.message || 'Unknown error');
    }).finally(() => {
      // 无论成功还是失败，都重置标记位
      isPdfLoggingRunning = false;
      console.debug('PDF容器日志监控已停止，重置标记位');
    });
  } catch (error) {
    console.debug('启动PDF容器日志监控失败:', error);
    // 发生异常时也要重置标记位
    isPdfLoggingRunning = false;
  }
}

// 更新文件状态的函数
function updateFileStatus(filePath: string, status: 'pending' | 'converting' | 'success' | 'failed', error?: string) {
  const fileIndex = persistentState.fileList.findIndex(file => file.path === filePath);
  
  if (fileIndex !== -1) {
    if (status === 'success') {
      // 成功时从列表中删除
      persistentState.fileList.splice(fileIndex, 1);
      console.log(`文件 ${path.basename(filePath)} 转换成功，已从待处理列表中移除`);
    } else if (status === 'failed') {
      // 失败时标记状态和错误信息
      persistentState.fileList[fileIndex].status = 'failed';
      persistentState.fileList[fileIndex].error = error;
      console.log(`文件 ${path.basename(filePath)} 转换失败，已标记为失败状态: ${error}`);
    } else {
      // 其他状态（converting等）只更新状态
      persistentState.fileList[fileIndex].status = status;
      console.log(`文件 ${path.basename(filePath)} 状态更新为: ${status}`);
    }
    
    // 广播文件列表更新到所有窗口
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-completed', {
        fileList: persistentState.fileList,
        updatedFile: {
          path: filePath,
          name: path.basename(filePath),
          status,
          error
        }
      });
    });
  } else {
    console.warn(`未找到待更新的文件: ${filePath}`);
  }
}

export default async function init(ipcMain: IpcMain) {
  // PDF转换服务
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, filePaths: string[], splitCount?: number) => {
      console.debug(`pdf-convert action: ${action}, serviceName: ${serviceName}, files: ${filePaths}, splitCount: ${splitCount}`);
      
      // 处理状态获取请求
      if (action === 'check') {
        // 检查是否有正在运行的任务
        const runningTasks = backgroundTask && backgroundTask.status === 'running' 
          ? backgroundTask 
          : null;
        
        // 启动PDF容器日志监控（页面进入时就开始监控）
        startPdfContainerLogging();
        
        event.reply(
          channel,
          MESSAGE_TYPE.DATA,
          new MessageData('check', serviceName as any, {
            fileList: persistentState.fileList,
            lastResult: persistentState.lastResult,
            runningTasks
          })
        );
        return;
      }
      
      if (action === 'split') {
        try {
          // 检查是否已有任务在运行
          if (backgroundTask && backgroundTask.status === 'running') {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '已有转换任务在后台运行，请等待完成后再试'
            );
            return;
          }

          // 验证文件路径和拆分参数
          if (!filePaths || filePaths.length !== 1) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '拆分功能只支持单个文件'
            );
            return;
          }

          if (!splitCount || splitCount < 2 || splitCount > 20) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '拆分份数必须在2-20之间'
            );
            return;
          }

          const filePath = filePaths[0];
          
          // 验证文件是否存在
          if (!fs.existsSync(filePath)) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              `文件不存在: ${filePath}`
            );
            return;
          }

          // 创建后台任务ID
          const taskId = uuidv4();
          backgroundTask = {
            taskId,
            filePaths,
            startTime: Date.now(),
            status: 'running'
          };

          // 启动PDF容器日志监控
          startPdfContainerLogging();

          // 立即返回任务开始响应
          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName as any, {
              taskId,
              status: 'started',
              message: `拆分转换任务已开始，将PDF拆分为${splitCount}份并逐一转换...`
            })
          );

          // 在后台执行拆分转换
          performSplitConversion(taskId, filePath, splitCount, ipcMain);

        } catch (error) {
          console.error('PDF拆分转换任务创建失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `任务创建失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      } else if (action === 'convert') {
        try {
          // 检查是否已有任务在运行
          if (backgroundTask && backgroundTask.status === 'running') {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '已有转换任务在后台运行，请等待完成后再试'
            );
            return;
          }

          // 验证文件路径
          if (!filePaths || filePaths.length === 0) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '没有提供有效的文件路径'
            );
            return;
          }

          // 验证文件是否存在
          for (const filePath of filePaths) {
            if (!fs.existsSync(filePath)) {
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `文件不存在: ${filePath}`
              );
              return;
            }
          }

          // 创建后台任务ID
          const taskId = uuidv4();
          backgroundTask = {
            taskId,
            filePaths,
            startTime: Date.now(),
            status: 'running'
          };

          // 启动PDF容器日志监控
          startPdfContainerLogging();

          // 立即返回任务开始响应
          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName as any, {
              taskId,
              status: 'started',
              message: '转换任务已开始，将在后台运行...'
            })
          );

          // 在后台执行转换
          performBackgroundConversion(taskId, filePaths, ipcMain);

        } catch (error) {
          console.error('PDF转换任务创建失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `任务创建失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      } else if (action === 'select') {
        try {
          const result = await dialog.showOpenDialog({
            title: '请选择PDF文件',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'PDF文件', extensions: ['pdf'] }],
          });

          if (!result.canceled && result.filePaths.length > 0) {
            // 更新持久化文件列表
            const newFiles = result.filePaths.map(filePath => ({
              name: path.basename(filePath),
              path: filePath,
              status: 'pending' as const
            }));
            
            // 合并到现有列表，避免重复
            const existingPaths = persistentState.fileList.map(f => f.path);
            const uniqueNewFiles = newFiles.filter(f => !existingPaths.includes(f.path));
            persistentState.fileList.push(...uniqueNewFiles);
            
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, 'PDF', result.filePaths)
            );
          } else {
            event.reply(
              channel,
              MESSAGE_TYPE.WARNING,
              '未选择文件'
            );
          }
        } catch (error) {
          console.error('文件选择失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `文件选择失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      } else if (action === 'remove') {
        try {
          // 验证是否提供了文件路径
          if (!filePaths || filePaths.length === 0) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '没有提供要删除的文件路径'
            );
            return;
          }

          const filePathToRemove = filePaths[0]; // 一次只删除一个文件
          
          // 检查文件是否正在转换
          const fileToRemove = persistentState.fileList.find(f => f.path === filePathToRemove);
          if (fileToRemove && fileToRemove.status === 'converting') {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '正在转换中的文件无法删除'
            );
            return;
          }

          // 从持久化列表中删除文件
          const originalLength = persistentState.fileList.length;
          persistentState.fileList = persistentState.fileList.filter(f => f.path !== filePathToRemove);
          
          if (persistentState.fileList.length < originalLength) {
            console.log(`成功从持久化列表中删除文件: ${path.basename(filePathToRemove)}`);
            
            // 广播文件列表更新到所有窗口
            const allWindows = BrowserWindow.getAllWindows();
            allWindows.forEach(window => {
              window.webContents.send('pdf-convert-completed', {
                fileList: persistentState.fileList,
                updatedFile: {
                  path: filePathToRemove,
                  name: path.basename(filePathToRemove),
                  status: 'removed'
                }
              });
            });
            
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName as any, {
                removedFilePath: filePathToRemove,
                message: '文件已从选择列表中删除'
              })
            );
          } else {
            event.reply(
              channel,
              MESSAGE_TYPE.WARNING,
              '未找到要删除的文件'
            );
          }
        } catch (error) {
          console.error('删除文件失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      }
    }
  );
}

// 拆分PDF文件函数
async function splitPdfFile(filePath: string, splitCount: number): Promise<{
  success: boolean;
  splitFiles: string[];
  error?: string;
}> {
  try {
    console.log(`开始拆分PDF文件: ${path.basename(filePath)} 为 ${splitCount} 份`);
    
    // 读取PDF文件
    const existingPdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    const totalPages = pdfDoc.getPageCount();
    console.log(`PDF总页数: ${totalPages}`);
    
    if (totalPages < splitCount) {
      return {
        success: false,
        splitFiles: [],
        error: `PDF页数(${totalPages})小于拆分份数(${splitCount})`
      };
    }
    
    const pagesPerSplit = Math.ceil(totalPages / splitCount);
    const splitFiles: string[] = [];
    
    // 创建拆分文件的目录
    const pdfDir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.pdf');
    const splitDir = path.join(pdfDir, `${baseName}_split_${splitCount}`);
    
    if (!fs.existsSync(splitDir)) {
      fs.mkdirSync(splitDir, { recursive: true });
    }
    
    // 拆分PDF
    for (let i = 0; i < splitCount; i++) {
      const newPdf = await PDFDocument.create();
      
      const startPage = i * pagesPerSplit;
      const endPage = Math.min(startPage + pagesPerSplit - 1, totalPages - 1);
      
      console.log(`创建第 ${i + 1} 份: 页面 ${startPage + 1} 到 ${endPage + 1}`);
      
      // 复制页面到新PDF
      const copiedPages = await newPdf.copyPages(pdfDoc, Array.from(
        { length: endPage - startPage + 1 }, 
        (_, idx) => startPage + idx
      ));
      
      copiedPages.forEach((page) => {
        newPdf.addPage(page);
      });
      
      // 保存拆分后的PDF文件
      const splitFileName = `${baseName}_part${i + 1}.pdf`;
      const splitFilePath = path.join(splitDir, splitFileName);
      
      const pdfBytes = await newPdf.save();
      fs.writeFileSync(splitFilePath, pdfBytes);
      
      splitFiles.push(splitFilePath);
      console.log(`已保存拆分文件: ${splitFilePath}`);
    }
    
    console.log(`PDF拆分完成，生成 ${splitFiles.length} 个文件`);
    
    return {
      success: true,
      splitFiles
    };
    
  } catch (error) {
    console.error(`拆分PDF文件失败: ${path.basename(filePath)}`, error);
    return {
      success: false,
      splitFiles: [],
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// 合并转换结果函数
async function mergeConversionResults(splitResults: Array<{
  success: boolean;
  savedFiles: string[];
  error?: string;
}>, originalFilePath: string): Promise<{
  success: boolean;
  savedFiles: string[];
  error?: string;
}> {
  try {
    const pdfDir = path.dirname(originalFilePath);
    const baseName = path.basename(originalFilePath, '.pdf');
    const mergedOutputDir = path.join(pdfDir, baseName);
    
    if (!fs.existsSync(mergedOutputDir)) {
      fs.mkdirSync(mergedOutputDir, { recursive: true });
    }
    
    const allSavedFiles: string[] = [];
    let mergedMdContent = '';
    const mergedImagesDir = path.join(mergedOutputDir, 'images');
    
    if (!fs.existsSync(mergedImagesDir)) {
      fs.mkdirSync(mergedImagesDir, { recursive: true });
    }
    
    // 处理每个拆分结果
    for (let i = 0; i < splitResults.length; i++) {
      const result = splitResults[i];
      
      if (!result.success) {
        continue;
      }
      
      for (const savedFile of result.savedFiles) {
        const fileName = path.basename(savedFile);
        const fileExt = path.extname(savedFile);
        
        if (fileExt === '.md') {
          // 合并MD文件
          const mdContent = fs.readFileSync(savedFile, 'utf8');
          if (mergedMdContent) {
            mergedMdContent += '\n\n---\n\n'; // 分隔符
          }
          mergedMdContent += `## 第 ${i + 1} 部分\n\n${mdContent}`;
        } else if (savedFile.includes('images')) {
          // 复制图片文件到合并目录
          const imageName = path.basename(savedFile);
          const mergedImagePath = path.join(mergedImagesDir, `part${i + 1}_${imageName}`);
          fs.copyFileSync(savedFile, mergedImagePath);
          allSavedFiles.push(mergedImagePath);
        } else if (fileName === 'middle.json') {
          // middle.json需要重命名保存，区分不同部分
          const mergedMiddlePath = path.join(mergedOutputDir, `middle_part${i + 1}.json`);
          fs.copyFileSync(savedFile, mergedMiddlePath);
          allSavedFiles.push(mergedMiddlePath);
          console.log(`已保存第 ${i + 1} 部分的middle.json: ${mergedMiddlePath}`);
        }
      }
    }
    
    // 保存合并后的MD文件
    if (mergedMdContent) {
      const mergedMdPath = path.join(mergedOutputDir, `${baseName}.md`);
      fs.writeFileSync(mergedMdPath, mergedMdContent, 'utf8');
      allSavedFiles.push(mergedMdPath);
    }
    
    console.log(`结果合并完成，共保存 ${allSavedFiles.length} 个文件`);
    console.log(`- 合并后的MD文件: ${mergedMdContent ? '1个' : '0个'}`);
    console.log(`- 重命名后的图片文件: ${allSavedFiles.filter(f => f.includes('images')).length}个`);
    console.log(`- 重命名后的middle.json文件: ${allSavedFiles.filter(f => f.includes('middle_part')).length}个`);
    
    return {
      success: true,
      savedFiles: allSavedFiles
    };
    
  } catch (error) {
    console.error('合并转换结果失败:', error);
    return {
      success: false,
      savedFiles: [],
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// 单个文件转换和解析函数
async function convertSinglePdfFile(filePath: string): Promise<{
  success: boolean;
  savedFiles: string[];
  error?: string;
}> {
  try {
    console.log(`开始转换单个PDF文件: ${path.basename(filePath)}`);
    
    // 获取当前配置
    const config = getCurrentPdfConfig();
    
    // 创建 FormData
    const form = new FormData();
    
    // 添加表单字段，使用配置中的值
    form.append('return_md', 'true');
    form.append('return_middle_json', 'true');
    form.append('return_model_output', 'false');
    form.append('return_content_list', 'false');
    form.append('return_images', 'true');
    form.append('parse_method', 'auto');
    form.append('start_page_id', config.start_page_id.toString());
    form.append('end_page_id', config.end_page_id.toString());
    form.append('lang_list', 'ch');
    form.append('output_dir', './output');
    form.append('server_url', '');
    form.append('backend', 'pipeline');
    form.append('table_enable', config.table_enable.toString());
    form.append('formula_enable', config.formula_enable.toString());

    // 添加单个文件
    const fileStream = fs.createReadStream(filePath);
    form.append('files', fileStream, {
      filename: path.basename(filePath),
      contentType: 'application/pdf'
    });

    // 创建 HTTP 请求
    const responseData = await new Promise<any>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 5000,
        path: '/file_parse',
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          'accept': 'application/json'
        }
      }, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (jsonError) {
            console.error('JSON解析失败:', jsonError);
            reject(new Error('服务返回的数据格式错误，无法解析JSON'));
          }
        });
      });

      req.on('error', (error) => {
        console.error('HTTP 请求失败:', error);
        reject(error);
      });

      req.setTimeout(36000000, () => {
        console.error('解析时间超过600分钟，连接已挂断');
        req.destroy();
        reject(new Error('解析超时'));
      });

      // 将 FormData 管道到请求
      form.pipe(req);
    });
    
    // 检查转换结果
    const success = responseData && Object.keys(responseData).length > 0;
    const savedFiles: string[] = [];
    
    // 处理results字段
    if (responseData.results && typeof responseData.results === 'object') {
      console.log(`开始处理PDF转换结果: ${path.basename(filePath)}`);
      
      for (const [pdfName, pdfResult] of Object.entries(responseData.results)) {
        try {
          const result = pdfResult as any;
          
          // 创建PDF同名文件夹（去掉.pdf后缀）
          const pdfDir = path.dirname(filePath);
          const baseName = path.basename(filePath, '.pdf');
          const outputDir = path.join(pdfDir, baseName);
          
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          console.log(`正在处理: ${pdfName} -> 输出目录: ${outputDir}`);
          
          // 1. 保存markdown内容
          if (result.md_content && typeof result.md_content === 'string') {
            const mdPath = path.join(outputDir, `${baseName}.md`);
            fs.writeFileSync(mdPath, result.md_content, 'utf8');
            savedFiles.push(mdPath);
            console.log(`已保存Markdown文件: ${mdPath}`);
          }
          
          // 2. 保存图片到 images 文件夹
          if (result.images && typeof result.images === 'object') {
            const imagesDir = path.join(outputDir, 'images');
            if (!fs.existsSync(imagesDir)) {
              fs.mkdirSync(imagesDir, { recursive: true });
            }
            
            for (const [imageName, dataUri] of Object.entries(result.images)) {
              try {
                const dataUriString = dataUri as string;
                
                // 先用 "base64," 截断数据
                const base64Index = dataUriString.indexOf('base64,');
                if (base64Index === -1) {
                  console.error(`图片 ${imageName} 的数据格式不正确，未找到base64标识，跳过`);
                  continue;
                }
                
                const headerPart = dataUriString.substring(0, base64Index + 7); // 包含 "base64,"
                const base64Data = dataUriString.substring(base64Index + 7); // 纯base64数据
                
                // 用正则匹配前面的字符串提取图片类型
                const typeMatch = headerPart.match(/^data:image\/([^;]+);base64,$/);
                if (!typeMatch) {
                  console.error(`图片 ${imageName} 的头部格式不正确，跳过`);
                  continue;
                }
                
                const imageType = typeMatch[1]; // 获取图片类型 (jpeg, png, etc.)
                
                // 根据图片类型确定文件扩展名
                const extension = imageType === 'jpeg' ? 'jpg' : imageType;
                
                // 生成带正确扩展名的文件名
                const baseImageName = path.parse(imageName).name || `image_${Date.now()}`;
                const finalImageName = `${baseImageName}.${extension}`;
                
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const imagePath = path.join(imagesDir, finalImageName);
                fs.writeFileSync(imagePath, imageBuffer);
                savedFiles.push(imagePath);
                console.log(`已保存图片: ${imagePath} (类型: ${imageType})`);
              } catch (imageError) {
                console.error(`保存图片 ${imageName} 失败:`, imageError);
              }
            }
          }
          
          // 3. 保存middle_json
          if (result.middle_json && typeof result.middle_json === 'string') {
            const middlePath = path.join(outputDir, 'middle.json');
            fs.writeFileSync(middlePath, result.middle_json, 'utf8');
            savedFiles.push(middlePath);
            console.log(`已保存中间JSON文件: ${middlePath}`);
          }
          
        } catch (fileError) {
          console.error(`处理PDF ${pdfName} 的结果时出错:`, fileError);
          return {
            success: false,
            savedFiles: [],
            error: `处理PDF结果时出错: ${fileError instanceof Error ? fileError.message : '未知错误'}`
          };
        }
      }
    } else {
      console.warn(`文件 ${path.basename(filePath)} 响应中没有找到results字段或格式不正确`);
      return {
        success: false,
        savedFiles: [],
        error: '服务响应格式不正确'
      };
    }
    
    return {
      success,
      savedFiles
    };
    
  } catch (error) {
    console.error(`转换PDF文件 ${path.basename(filePath)} 失败:`, error);
    return {
      success: false,
      savedFiles: [],
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// 拆分转换函数 - 将PDF拆分后逐个转换并合并结果
async function performSplitConversion(taskId: string, filePath: string, splitCount: number, ipcMain: IpcMain) {
  try {
    console.debug('Starting split conversion for task:', taskId);
    console.log(`开始拆分转换PDF文件: ${path.basename(filePath)}, 拆分为 ${splitCount} 份`);
    
    // 更新文件状态为转换中，并设置拆分信息
    const fileIndex = persistentState.fileList.findIndex(file => file.path === filePath);
    if (fileIndex !== -1) {
      persistentState.fileList[fileIndex].status = 'converting';
      persistentState.fileList[fileIndex].splitParts = splitCount;
      persistentState.fileList[fileIndex].currentSplitProgress = 0;
    }
    
    // 广播初始状态更新
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-progress', {
        taskId,
        type: 'split',
        total: splitCount,
        completed: 0,
        successful: 0,
        failed: 0,
        currentFile: path.basename(filePath),
        message: '正在拆分PDF文件...'
      });
    });
    
    // 第一步：拆分PDF文件
    const splitResult = await splitPdfFile(filePath, splitCount);
    
    if (!splitResult.success) {
      throw new Error(`PDF拆分失败: ${splitResult.error}`);
    }
    
    console.log(`PDF拆分成功，生成 ${splitResult.splitFiles.length} 个文件`);
    
    // 第二步：逐个转换拆分后的文件
    const splitResults: Array<{
      success: boolean;
      savedFiles: string[];
      error?: string;
    }> = [];
    
    let completedSplits = 0;
    let successfulSplits = 0;
    let failedSplits = 0;
    
    for (let i = 0; i < splitResult.splitFiles.length; i++) {
      const splitFilePath = splitResult.splitFiles[i];
      const splitFileName = path.basename(splitFilePath);
      
      try {
        console.log(`开始转换第 ${i + 1}/${splitCount} 个拆分文件: ${splitFileName}`);
        
        // 更新进度
        allWindows.forEach(window => {
          window.webContents.send('pdf-convert-progress', {
            taskId,
            type: 'split',
            total: splitCount,
            completed: completedSplits,
            successful: successfulSplits,
            failed: failedSplits,
            currentFile: `${path.basename(filePath)} (第${i + 1}部分)`,
            currentSplit: i + 1,
            message: `正在转换第 ${i + 1}/${splitCount} 个拆分文件: ${splitFileName}`
          });
        });
        
        // 转换单个拆分文件
        const convertResult = await convertSinglePdfFile(splitFilePath);
        splitResults.push(convertResult);
        
        completedSplits++;
        
        if (convertResult.success) {
          successfulSplits++;
          console.log(`第 ${i + 1} 个拆分文件转换成功`);
        } else {
          failedSplits++;
          console.error(`第 ${i + 1} 个拆分文件转换失败: ${convertResult.error}`);
        }
        
        // 更新文件的拆分进度
        if (fileIndex !== -1) {
          persistentState.fileList[fileIndex].currentSplitProgress = completedSplits;
        }
        
        // 发送进度更新
        allWindows.forEach(window => {
          window.webContents.send('pdf-convert-progress', {
            taskId,
            type: 'split',
            total: splitCount,
            completed: completedSplits,
            successful: successfulSplits,
            failed: failedSplits,
            currentFile: `${path.basename(filePath)} (第${i + 1}部分)`,
            currentSplit: i + 1,
            message: `已完成 ${completedSplits}/${splitCount} 个拆分文件，成功: ${successfulSplits}，失败: ${failedSplits}`
          });
        });
        
      } catch (splitError) {
        failedSplits++;
        completedSplits++;
        const errorMessage = splitError instanceof Error ? splitError.message : '未知错误';
        console.error(`处理第 ${i + 1} 个拆分文件时发生错误:`, splitError);
        
        splitResults.push({
          success: false,
          savedFiles: [],
          error: errorMessage
        });
      }
    }
    
    // 第三步：合并转换结果
    console.log('开始合并转换结果...');
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-progress', {
        taskId,
        type: 'split',
        total: splitCount,
        completed: completedSplits,
        successful: successfulSplits,
        failed: failedSplits,
        currentFile: path.basename(filePath),
        message: '正在合并转换结果...'
      });
    });
    
    const mergeResult = await mergeConversionResults(splitResults, filePath);
    
    // 清理拆分文件（可选）
    try {
      for (const splitFile of splitResult.splitFiles) {
        if (fs.existsSync(splitFile)) {
          fs.unlinkSync(splitFile);
        }
      }
      // 删除拆分目录（如果为空）
      const splitDir = path.dirname(splitResult.splitFiles[0]);
      if (fs.existsSync(splitDir) && fs.readdirSync(splitDir).length === 0) {
        fs.rmdirSync(splitDir);
      }
    } catch (cleanupError) {
      console.warn('清理拆分文件时出错:', cleanupError);
    }
    
    // 计算最终结果
    const overallSuccess = mergeResult.success && successfulSplits > 0;
    
    // 生成最终消息
    let finalMessage: string;
    if (overallSuccess) {
      if (successfulSplits === splitCount) {
        finalMessage = `PDF拆分转换完全成功！成功转换 ${successfulSplits}/${splitCount} 个拆分文件并合并结果`;
      } else {
        finalMessage = `PDF拆分转换部分成功！成功转换 ${successfulSplits}/${splitCount} 个拆分文件并合并结果`;
      }
    } else {
      finalMessage = `PDF拆分转换失败！成功转换 ${successfulSplits}/${splitCount} 个拆分文件`;
    }
    
    console.log(finalMessage);
    
    // 更新任务状态
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask.status = 'completed';
      backgroundTask.result = {
        success: overallSuccess,
        message: finalMessage,
        data: {
          splitCount,
          successfulSplits,
          failedSplits,
          type: 'split'
        },
        savedFiles: mergeResult.savedFiles,
        convertedFiles: overallSuccess ? [filePath] : []
      };
    }
    
    // 更新持久化状态
    persistentState.lastResult = backgroundTask?.result;
    
    // 更新文件状态
    if (overallSuccess) {
      updateFileStatus(filePath, 'success');
    } else {
      updateFileStatus(filePath, 'failed', mergeResult.error || `转换失败，成功: ${successfulSplits}/${splitCount}`);
    }
    
    // 广播转换完成消息到所有窗口
    const result = {
      taskId,
      success: overallSuccess,
      message: finalMessage,
      data: {
        splitCount,
        successfulSplits,
        failedSplits,
        type: 'split'
      },
      savedFiles: mergeResult.savedFiles,
      convertedFiles: overallSuccess ? [filePath] : []
    };
    
    // 发送完成通知到所有窗口
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-completed', result);
    });
    
    // 清理已完成的任务
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask = null;
    }
    
    console.log(`Split conversion completed for task: ${taskId} - ${successfulSplits}/${splitCount} splits successful`);
    
  } catch (error) {
    console.error(`Split conversion failed for task ${taskId}:`, error);
    
    // 更新任务状态为失败
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask.status = 'failed';
      backgroundTask.result = {
        success: false,
        message: `PDF拆分转换任务失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
    
    // 更新持久化状态
    persistentState.lastResult = backgroundTask?.result;
    
    // 更新文件状态为失败
    updateFileStatus(filePath, 'failed', error instanceof Error ? error.message : '未知错误');
    
    // 广播转换失败消息
    const result = {
      taskId,
      success: false,
      message: `PDF拆分转换任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
      convertedFiles: [filePath] // 包含失败的文件，用于前端处理
    };
    
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-completed', result);
    });
    
    // 清理失败的任务
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask = null;
    }
  }
}

// 后台转换函数 - 改造为逐个处理文件
async function performBackgroundConversion(taskId: string, filePaths: string[], ipcMain: IpcMain) {
  try {
    console.debug('Starting background conversion for task:', taskId);
    console.log(`开始批量转换 ${filePaths.length} 个PDF文件`);
    
    const allSavedFiles: string[] = [];
    const convertedFiles: string[] = [];
    const failedFiles: string[] = [];
    let totalFiles = filePaths.length;
    let completedFiles = 0;
    
    // 逐个处理文件
    for (const filePath of filePaths) {
      try {
        console.log(`开始处理文件 ${completedFiles + 1}/${totalFiles}: ${path.basename(filePath)}`);
        
        // 更新文件状态为转换中
        updateFileStatus(filePath, 'converting');
        
        // 转换单个文件
        const result = await convertSinglePdfFile(filePath);
        
        if (result.success) {
          allSavedFiles.push(...result.savedFiles);
          convertedFiles.push(filePath);
          console.log(`文件 ${path.basename(filePath)} 转换成功，保存了 ${result.savedFiles.length} 个文件`);
          
          // 更新文件状态为成功（会从列表中删除）
          updateFileStatus(filePath, 'success');
        } else {
          failedFiles.push(filePath);
          console.error(`文件 ${path.basename(filePath)} 转换失败: ${result.error}`);
          
          // 更新文件状态为失败（会标记失败状态）
          updateFileStatus(filePath, 'failed', result.error);
        }
        
        completedFiles++;
        
        // 发送进度更新
        const progressMessage = `已完成 ${completedFiles}/${totalFiles} 个文件，成功: ${convertedFiles.length}，失败: ${failedFiles.length}`;
        console.log(progressMessage);
        
        // 广播进度更新到所有窗口
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach(window => {
          window.webContents.send('pdf-convert-progress', {
            taskId,
            total: totalFiles,
            completed: completedFiles,
            successful: convertedFiles.length,
            failed: failedFiles.length,
            currentFile: path.basename(filePath),
            message: progressMessage
          });
        });
        
      } catch (fileError) {
        failedFiles.push(filePath);
        completedFiles++;
        const errorMessage = fileError instanceof Error ? fileError.message : '未知错误';
        console.error(`处理文件 ${path.basename(filePath)} 时发生错误:`, fileError);
        
        // 更新文件状态为失败
        updateFileStatus(filePath, 'failed', `处理时发生错误: ${errorMessage}`);
      }
    }
    
    // 计算最终结果
    const overallSuccess = convertedFiles.length > 0;
    const hasFailures = failedFiles.length > 0;
    
    // 生成最终消息
    let finalMessage: string;
    if (convertedFiles.length === totalFiles) {
      finalMessage = `PDF转换完全成功！成功转换 ${convertedFiles.length} 个文件：${convertedFiles.map(fp => path.basename(fp)).join(', ')}`;
    } else if (convertedFiles.length > 0) {
      finalMessage = `PDF转换部分成功！成功转换 ${convertedFiles.length}/${totalFiles} 个文件。失败文件：${failedFiles.map(fp => path.basename(fp)).join(', ')}`;
    } else {
      finalMessage = `PDF转换失败！所有 ${totalFiles} 个文件都转换失败。`;
    }
    
    console.log(finalMessage);
    
    // 更新任务状态
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask.status = 'completed';
      backgroundTask.result = {
        success: overallSuccess,
        message: finalMessage,
        data: {
          totalFiles,
          successfulFiles: convertedFiles.length,
          failedFiles: failedFiles.length,
          convertedFileNames: convertedFiles.map(fp => path.basename(fp)),
          failedFileNames: failedFiles.map(fp => path.basename(fp))
        },
        savedFiles: allSavedFiles,
        convertedFiles
      };
    }
    
    // 更新持久化状态
    persistentState.lastResult = backgroundTask?.result;
    
    // 注意：文件列表的更新已经在 updateFileStatus 函数中实时处理了
    
    // 广播转换完成消息到所有窗口
    const result = {
      taskId,
      success: overallSuccess,
      message: finalMessage,
      data: {
        totalFiles,
        successfulFiles: convertedFiles.length,
        failedFiles: failedFiles.length,
        convertedFileNames: convertedFiles.map(fp => path.basename(fp)),
        failedFileNames: failedFiles.map(fp => path.basename(fp))
      },
      savedFiles: allSavedFiles,
      convertedFiles
    };
    
    // 发送完成通知到所有窗口
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-completed', result);
    });
    
    // 清理已完成的任务
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask = null;
    }
    
    console.log(`Background conversion completed for task: ${taskId} - ${convertedFiles.length}/${totalFiles} files successful`);
    
  } catch (error) {
    console.error(`Background conversion failed for task ${taskId}:`, error);
    
    // 更新任务状态为失败
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask.status = 'failed';
      backgroundTask.result = {
        success: false,
        message: `PDF转换任务失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
    
    // 更新持久化状态
    persistentState.lastResult = backgroundTask?.result;
    
    // 广播转换失败消息
    const result = {
      taskId,
      success: false,
      message: `PDF转换任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
      convertedFiles: filePaths // 包含失败的文件列表，用于前端处理
    };
    
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('pdf-convert-completed', result);
    });
    
    // 清理失败的任务
    if (backgroundTask && backgroundTask.taskId === taskId) {
      backgroundTask = null;
    }
  }
} 