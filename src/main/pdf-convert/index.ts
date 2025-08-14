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
  splitCount?: number; // 拆分数量，默认为1
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
    async (event, action: ActionName, serviceName: ServiceName, data: any) => {
      console.debug(`pdf-convert action: ${action}, serviceName: ${serviceName}, data:`, data);
      
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
      
      if (action === 'convert') {
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

          // 兼容旧版本（data为string[]）和新版本（data为包含splitCount的对象数组）
          let fileData: Array<{path: string, splitCount: number}>;
          
          if (Array.isArray(data)) {
            // 检查第一个元素是否为字符串（旧版本）
            if (typeof data[0] === 'string') {
              // 旧版本：data是string[]
              fileData = (data as string[]).map(filePath => ({
                path: filePath,
                splitCount: 1
              }));
            } else {
              // 新版本：data已经是对象数组
              fileData = data as Array<{path: string, splitCount: number}>;
            }
          } else {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '数据格式错误'
            );
            return;
          }

          // 验证文件路径
          if (!fileData || fileData.length === 0) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              '没有提供有效的文件路径'
            );
            return;
          }

          // 验证文件是否存在
          for (const fileInfo of fileData) {
            if (!fs.existsSync(fileInfo.path)) {
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `文件不存在: ${fileInfo.path}`
              );
              return;
            }
          }

          // 创建后台任务ID
          const taskId = uuidv4();
          backgroundTask = {
            taskId,
            filePaths: fileData.map(f => f.path), // 为了向后兼容
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

          // 在后台执行转换，传递完整的文件数据
          performBackgroundConversion(taskId, fileData, ipcMain);

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
              status: 'pending' as const,
              splitCount: 1 // 默认拆分数量为1
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
          // 兼容旧版本和新版本
          let filePaths: string[];
          if (Array.isArray(data) && typeof data[0] === 'string') {
            filePaths = data as string[];
          } else {
            filePaths = []; // 如果格式不对，设为空数组
          }

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

// 单个文件转换和解析函数
async function convertSinglePdfFile(filePath: string, splitCount: number = 1): Promise<{
  success: boolean;
  savedFiles: string[];
  error?: string;
}> {
  try {
    console.log(`开始转换单个PDF文件: ${path.basename(filePath)}，拆分数量: ${splitCount}`);
    
    if (splitCount === 1) {
      // 不拆分，直接转换
      return await convertPdfFileDirectly(filePath);
    } else {
      // 拆分转换并合并结果
      return await convertPdfFileWithSplit(filePath, splitCount);
    }
    
  } catch (error) {
    console.error(`转换PDF文件 ${path.basename(filePath)} 失败:`, error);
    return {
      success: false,
      savedFiles: [],
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// 直接转换PDF文件（不拆分）
async function convertPdfFileDirectly(filePath: string): Promise<{
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

// 拆分转换PDF文件并合并结果
async function convertPdfFileWithSplit(filePath: string, splitCount: number): Promise<{
  success: boolean;
  savedFiles: string[];
  error?: string;
}> {
  try {
    console.log(`开始拆分转换PDF文件: ${path.basename(filePath)}，拆分为 ${splitCount} 份`);
    
    // 创建输出目录
    const pdfDir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.pdf');
    const outputDir = path.join(pdfDir, baseName);
    const tempDir = path.join(outputDir, 'temp_splits'); // 临时目录存储拆分的PDF文件
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 读取原始PDF文件
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    console.log(`PDF总页数: ${totalPages}`);
    
    if (totalPages <= splitCount) {
      console.log(`页数不足，每份1页，实际拆分 ${totalPages} 份`);
      splitCount = totalPages;
    }
    
    const pagesPerSplit = Math.ceil(totalPages / splitCount);
    console.log(`每部分处理 ${pagesPerSplit} 页`);
    
    const splitFiles: string[] = [];
    const allSavedFiles: string[] = [];
    const allMarkdowns: string[] = [];
    const allMiddleJsons: string[] = [];
    const imagesDir = path.join(outputDir, 'images');
    
    // 创建images目录
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    // 第一步：使用pdf-lib拆分PDF文件
    console.log('开始拆分PDF文件...');
    for (let i = 0; i < splitCount; i++) {
      try {
        const startPage = i * pagesPerSplit;
        const endPage = Math.min(startPage + pagesPerSplit - 1, totalPages - 1);
        
        console.log(`创建第 ${i + 1}/${splitCount} 份: 页面 ${startPage + 1}-${endPage + 1}`);
        
        // 创建新的PDF文档
        const newPdfDoc = await PDFDocument.create();
        
        // 复制页面到新文档
        const pageIndices = [];
        for (let pageIdx = startPage; pageIdx <= endPage; pageIdx++) {
          pageIndices.push(pageIdx);
        }
        
        const copiedPages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => newPdfDoc.addPage(page));
        
        // 保存拆分后的PDF文件
        const splitFileName = `${baseName}_part${i + 1}.pdf`;
        const splitFilePath = path.join(tempDir, splitFileName);
        const splitPdfBytes = await newPdfDoc.save();
        
        fs.writeFileSync(splitFilePath, splitPdfBytes);
        splitFiles.push(splitFilePath);
        
        console.log(`保存拆分文件: ${splitFilePath}`);
        
      } catch (splitError) {
        console.error(`拆分第 ${i + 1} 份时出错:`, splitError);
        throw new Error(`拆分第 ${i + 1} 份失败: ${splitError instanceof Error ? splitError.message : '未知错误'}`);
      }
    }
    
    let successfulSplits = 0;
    
    // 第二步：对每个拆分文件调用convertSinglePdfFile进行转换
    console.log('开始转换拆分的PDF文件...');
    for (let i = 0; i < splitFiles.length; i++) {
      try {
        const splitFilePath = splitFiles[i];
        console.log(`处理第 ${i + 1}/${splitFiles.length} 份: ${path.basename(splitFilePath)}`);
        
        // 调用convertPdfFileDirectly处理单个拆分文件
        const result = await convertPdfFileDirectly(splitFilePath);
        
        if (result.success) {
          successfulSplits++;
          
          // 处理转换结果
          for (const savedFile of result.savedFiles) {
            const fileName = path.basename(savedFile);
            const fileExt = path.extname(savedFile);
            const fileDir = path.dirname(savedFile);
            
            if (fileExt === '.md') {
              // 读取markdown内容并收集
              const mdContent = fs.readFileSync(savedFile, 'utf8');
              allMarkdowns.push(mdContent);
              console.log(`收集第 ${i + 1} 份的Markdown内容，长度: ${mdContent.length}`);
              
              // 删除临时的markdown文件
              fs.unlinkSync(savedFile);
            } else if (fileExt === '.json' && fileName.startsWith('middle')) {
              // 重命名middle.json为middle1.json, middle2.json等
              const newMiddlePath = path.join(outputDir, `middle${i + 1}.json`);
              fs.copyFileSync(savedFile, newMiddlePath);
              allMiddleJsons.push(newMiddlePath);
              allSavedFiles.push(newMiddlePath);
              console.log(`保存中间JSON文件: ${newMiddlePath}`);
              
              // 删除临时的json文件
              fs.unlinkSync(savedFile);
            } else if (savedFile.includes('/images/') || savedFile.includes('\\images\\')) {
              // 移动图片文件到主images目录
              const imageFileName = path.basename(savedFile);
              const targetImagePath = path.join(imagesDir, imageFileName);
              
              // 检查文件是否已存在，如果不存在才移动
              if (!fs.existsSync(targetImagePath)) {
                fs.copyFileSync(savedFile, targetImagePath);
                allSavedFiles.push(targetImagePath);
                console.log(`移动图片: ${targetImagePath}`);
              } else {
                console.log(`图片已存在，跳过: ${targetImagePath}`);
              }
              
              // 删除临时的图片文件
              try {
                fs.unlinkSync(savedFile);
              } catch (delError) {
                console.warn(`删除临时图片失败: ${savedFile}`, delError);
              }
            }
          }
          
          // 删除拆分文件的输出目录（清理临时文件）
          const splitOutputDir = path.dirname(splitFilePath.replace('temp_splits', path.basename(splitFilePath, '.pdf')));
          if (fs.existsSync(splitOutputDir) && splitOutputDir !== outputDir) {
            try {
              fs.rmSync(splitOutputDir, { recursive: true, force: true });
              console.log(`清理临时目录: ${splitOutputDir}`);
            } catch (cleanError) {
              console.warn(`清理临时目录失败: ${splitOutputDir}`, cleanError);
            }
          }
          
        } else {
          console.error(`第 ${i + 1} 份转换失败: ${result.error}`);
          throw new Error(`第 ${i + 1} 份转换失败: ${result.error}`);
        }
        
      } catch (convertError) {
        console.error(`处理第 ${i + 1} 份时出错:`, convertError);
        // 清理临时目录
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`清理临时拆分目录: ${tempDir}`);
        } catch (cleanError) {
          console.warn(`清理临时拆分目录失败: ${tempDir}`, cleanError);
        }
        throw new Error(`处理第 ${i + 1} 份失败，中断整个转换流程: ${convertError instanceof Error ? convertError.message : '未知错误'}`);
      }
    }
    
    // 检查是否所有分段都转换成功
    if (successfulSplits !== splitCount) {
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`清理临时拆分目录: ${tempDir}`);
      } catch (cleanError) {
        console.warn(`清理临时拆分目录失败: ${tempDir}`, cleanError);
      }
      throw new Error(`拆分转换失败，只有 ${successfulSplits}/${splitCount} 份转换成功，需要全部成功才能完成转换`);
    }
    
    // 第三步：合并所有markdown内容
    if (allMarkdowns.length > 0) {
      const mergedMarkdown = allMarkdowns.join('\n\n---\n\n'); // 用分隔线连接各部分
      const mdPath = path.join(outputDir, `${baseName}.md`);
      fs.writeFileSync(mdPath, mergedMarkdown, 'utf8');
      allSavedFiles.push(mdPath);
      console.log(`合并并保存Markdown文件: ${mdPath}，包含 ${allMarkdowns.length} 个部分`);
    }
    
    // 清理临时目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`清理临时拆分目录: ${tempDir}`);
    } catch (cleanError) {
      console.warn(`清理临时拆分目录失败: ${tempDir}`, cleanError);
    }
    
    const message = `拆分转换完成，成功处理 ${successfulSplits}/${splitCount} 份，共 ${totalPages} 页`;
    console.log(message);
    
    return {
      success: true,
      savedFiles: allSavedFiles,
      error: undefined
    };
    
  } catch (error) {
    console.error(`拆分转换PDF文件 ${path.basename(filePath)} 失败:`, error);
    return {
      success: false,
      savedFiles: [],
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// 后台转换函数 - 改造为逐个处理文件
async function performBackgroundConversion(taskId: string, fileData: Array<{path: string, splitCount: number}>, ipcMain: IpcMain) {
  try {
    console.debug('Starting background conversion for task:', taskId);
    console.log(`开始批量转换 ${fileData.length} 个PDF文件`);
    
    const allSavedFiles: string[] = [];
    const convertedFiles: string[] = [];
    const failedFiles: string[] = [];
    let totalFiles = fileData.length;
    let completedFiles = 0;
    
    // 逐个处理文件
    for (const fileInfo of fileData) {
      try {
        console.log(`开始处理文件 ${completedFiles + 1}/${totalFiles}: ${path.basename(fileInfo.path)} (拆分${fileInfo.splitCount}份)`);
        
        // 更新文件状态为转换中
        updateFileStatus(fileInfo.path, 'converting');
        
        // 转换单个文件（包含拆分信息）
        const result = await convertSinglePdfFile(fileInfo.path, fileInfo.splitCount);
        
        if (result.success) {
          allSavedFiles.push(...result.savedFiles);
          convertedFiles.push(fileInfo.path);
          console.log(`文件 ${path.basename(fileInfo.path)} 转换成功，保存了 ${result.savedFiles.length} 个文件`);
          
          // 更新文件状态为成功（会从列表中删除）
          updateFileStatus(fileInfo.path, 'success');
        } else {
          failedFiles.push(fileInfo.path);
          console.error(`文件 ${path.basename(fileInfo.path)} 转换失败: ${result.error}`);
          
          // 更新文件状态为失败（会标记失败状态）
          updateFileStatus(fileInfo.path, 'failed', result.error);
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
            currentFile: path.basename(fileInfo.path),
            message: progressMessage
          });
        });
        
      } catch (fileError) {
        failedFiles.push(fileInfo.path);
        completedFiles++;
        const errorMessage = fileError instanceof Error ? fileError.message : '未知错误';
        console.error(`处理文件 ${path.basename(fileInfo.path)} 时发生错误:`, fileError);
        
        // 更新文件状态为失败
        updateFileStatus(fileInfo.path, 'failed', `处理时发生错误: ${errorMessage}`);
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
      convertedFiles: fileData.map(f => f.path) // 包含失败的文件列表，用于前端处理
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