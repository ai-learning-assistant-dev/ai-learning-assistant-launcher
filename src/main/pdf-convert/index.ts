import path from 'node:path';
import { appPath, Exec } from '../exec';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { escape } from 'node:querystring';
import http from 'node:http';
import FormData from 'form-data';
import { dialog, IpcMain } from 'electron';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ActionName, ServiceName } from './type-info';

const exec = new Exec();
const channel = 'pdf-convert';

export default async function init(ipcMain: IpcMain) {
  // PDF转换服务
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, filePaths: string[]) => {
      console.debug(`pdf-convert action: ${action}, serviceName: ${serviceName}, files: ${filePaths}`);
      
      if (action === 'convert') {
        try {
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

          // 使用 Node.js HTTP 模块进行请求
          console.debug('Preparing HTTP request with files:', filePaths);

          // 创建 FormData
          const form = new FormData();
          
          // 添加表单字段
          form.append('return_md', 'true');
          form.append('return_middle_json', 'true');
          form.append('return_model_output', 'false');
          form.append('return_content_list', 'false');
          form.append('return_images', 'true');
          form.append('parse_method', 'auto');
          form.append('start_page_id', '0');
          form.append('end_page_id', '99999');
          form.append('lang_list', 'ch');
          form.append('output_dir', './output');
          form.append('server_url', '');
          form.append('backend', 'pipeline');
          form.append('table_enable', 'true');
          form.append('formula_enable', 'true');

          // 添加文件
          filePaths.forEach((filePath) => {
            const fileStream = fs.createReadStream(filePath);
            form.append('files', fileStream, {
              filename: path.basename(filePath),
              contentType: 'application/pdf'
            });
          });

          try {
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

              // 将 FormData 管道到请求
              form.pipe(req);
            });
            
            // 检查转换结果 - 返回值不为空即成功
            const success = responseData && Object.keys(responseData).length > 0;
            
            // 保存转换后的文件
            const savedFiles: string[] = [];
            
            // 处理results字段
            if (responseData.results && typeof responseData.results === 'object') {
              console.log('开始处理PDF转换结果...');
              
              for (const [pdfName, pdfResult] of Object.entries(responseData.results)) {
                try {
                  const result = pdfResult as any;
                  
                  // 获取原始PDF文件路径
                  const originalPdfPath = filePaths.find(fp => 
                    path.basename(fp, '.pdf') === path.basename(pdfName, '.pdf') || 
                    path.basename(fp) === pdfName
                  );
                  
                  if (!originalPdfPath) {
                    console.warn(`未找到对应的原始PDF文件: ${pdfName}`);
                    continue;
                  }
                  
                  // 创建PDF同名文件夹（去掉.pdf后缀）
                  const pdfDir = path.dirname(originalPdfPath);
                  const baseName = path.basename(originalPdfPath, '.pdf');
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
                }
              }
            } else {
              console.warn('响应中没有找到results字段或格式不正确');
            }
            
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName as any, {
                success,
                message: success ? 
                  `PDF转换成功！已保存 ${savedFiles.length} 个文件` : 
                  'PDF处理完成但可能存在问题',
                data: responseData,
                savedFiles
              })
            );
          } catch (execError) {
            console.error('HTTP请求执行失败:', execError);
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              `PDF转换失败: ${execError instanceof Error ? execError.message : '未知错误'}`
            );
          }

        } catch (error) {
          console.error('PDF转换失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `PDF转换失败: ${error instanceof Error ? error.message : '未知错误'}`
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
      }
    }
  );
} 