import { IpcMain } from 'electron';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import { appPath } from '../exec';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

const exec = new Exec();
const channel = 'pdf-convert';

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: string, serviceName: string, filePaths: string[]) => {
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

          // 构建curl命令
          const curlArgs = [
            '-X', 'POST',
            'http://127.0.0.1:5000/file_parse',
            '-H', 'accept: application/json',
            '-F', 'return_md=true',
            '-F', 'return_middle_json=false',
            '-F', 'return_model_output=false',
            '-F', 'return_content_list=false',
            '-F', 'return_images=false',
            '-F', 'parse_method=auto',
            '-F', 'start_page_id=0',
            '-F', 'end_page_id=99999',
            '-F', 'lang_list=ch',
            '-F', 'output_dir=./output',
            '-F', 'server_url=',
            '-F', 'backend=pipeline',
            '-F', 'table_enable=true',
            '-F', 'formula_enable=true'
          ];

          // 添加文件参数
          filePaths.forEach((filePath) => {
            curlArgs.push('-F', `files=@${filePath}`);
          });

          console.debug('Executing curl command:', curlArgs);

          try {
            const result = await exec.exec('curl', curlArgs);
            
            // 如果执行成功，解析响应
            try {
              const responseData = JSON.parse(result.stdout);
              
              // 检查转换结果
              const success = responseData && responseData.success !== false;
              const translationCorrect = responseData?.translation_correct || false;
              
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  success,
                  message: success ? 'PDF转换成功！' : 'PDF转换失败',
                  translationCorrect,
                  data: responseData
                })
              );
            } catch (parseError) {
              console.error('解析响应失败:', parseError);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '解析PDF服务响应失败'
              );
            }
          } catch (execError) {
            console.error('curl命令执行失败:', execError);
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
      }
    }
  );
} 