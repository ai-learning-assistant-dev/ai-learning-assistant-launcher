import { IpcMain, dialog } from 'electron';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import { appPath } from '../exec';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

const exec = new Exec();
const channel = 'pdf-convert';
const selectFilesChannel = 'select-pdf-files';

export default async function init(ipcMain: IpcMain) {
  // PDF转换服务
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
            '-F', 'return_middle_json=true',
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

          // 执行curl命令，但忽略其响应，作为临时补救措施
          try {
            await exec.exec('curl', curlArgs);
          } catch (e) {
            console.warn('curl 命令执行失败，但作为临时措施，将继续尝试从容器拷贝文件。', e.message);
          }

          // 补救措施：直接从容器中拷贝文件
          // 1. 在容器的 /workspace/output 目录中找到最新的输出文件夹 (以UUID命名)
          let newestDir = '';
          try {
            const listCmdResult = await exec.exec('podman', ['exec', 'PDF', 'ls', '-t', '/workspace/output']);
            newestDir = listCmdResult.stdout.split('\n')[0].trim();
          } catch (e) {
            console.error('在容器中列出 /workspace/output 目录失败。', e);
            throw new Error("无法在容器中找到输出目录。PDF服务可能没有成功处理文件。");
          }

          if (!newestDir) {
            throw new Error('在容器中找不到任何输出目录。');
          }

          console.debug(`在容器中找到最新的输出目录: ${newestDir}`);

          // 2. 遍历每个输入文件，将其对应的输出文件夹拷贝回宿主机
          for (const filePath of filePaths) {
            const pdfBasename = path.basename(filePath, path.extname(filePath));
            const containerSourcePath = path.posix.join('/workspace/output', newestDir, pdfBasename);
            const hostDestPath = path.dirname(filePath);

            console.debug(`准备从容器拷贝: ${containerSourcePath} 到宿主机: ${hostDestPath}`);
            
            await exec.exec('podman', ['cp', `PDF:${containerSourcePath}`, hostDestPath]);
          }

          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName as any, {
              success: true,
              message: 'PDF转换完成！输出文件已保存到原始PDF所在目录。',
              translationCorrect: undefined, // 无法再得知此信息
              data: {}
            })
          );
        } catch (error) {
          console.error('PDF转换或文件拷贝失败:', error);
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `操作失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      }
    }
  );

  // 文件选择服务
  ipcMain.on(
    selectFilesChannel,
    async (event, action: string) => {
      console.debug(`select-pdf-files action: ${action}`);
      
      if (action === 'select') {
        try {
          const result = await dialog.showOpenDialog({
            title: '请选择PDF文件',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'PDF文件', extensions: ['pdf'] }],
          });

          if (!result.canceled && result.filePaths.length > 0) {
            event.reply(
              selectFilesChannel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, 'select', result.filePaths)
            );
          } else {
            event.reply(
              selectFilesChannel,
              MESSAGE_TYPE.WARNING,
              '未选择文件'
            );
          }
        } catch (error) {
          console.error('文件选择失败:', error);
          event.reply(
            selectFilesChannel,
            MESSAGE_TYPE.ERROR,
            `文件选择失败: ${error instanceof Error ? error.message : '未知错误'}`
          );
        }
      }
    }
  );
} 