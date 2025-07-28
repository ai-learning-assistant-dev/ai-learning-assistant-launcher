import { Button, message, Card, Typography, Space, List } from 'antd';
import { FileTextOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './index.scss';

const { Title, Text } = Typography;

interface ConversionResult {
  success: boolean;
  message: string;
  translationCorrect?: boolean;
}

interface FileItem {
  name: string;
  path: string;
}

export default function PdfConvert() {
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);

  const handleFileSelect = async () => {
    try {
      // 通过IPC调用主进程的文件选择对话框
      window.electron.ipcRenderer.sendMessage('select-pdf-files', 'select');
    } catch (error) {
      console.error('选择文件失败:', error);
      message.error('选择文件失败');
    }
  };

  const removeFile = (index: number) => {
    const newFileList = fileList.filter((_, i) => i !== index);
    setFileList(newFileList);
  };

  const convertPdfToMarkdown = async () => {
    if (fileList.length === 0) {
      message.warning('请先选择PDF文件');
      return;
    }

    setConverting(true);
    setResult(null);

    try {
      // 获取文件路径
      const filePaths = fileList.map((file) => file.path);
      
      // 通过IPC调用主进程的PDF转换服务
      window.electron.ipcRenderer.sendMessage('pdf-convert', 'convert', 'PDF', filePaths);

    } catch (error) {
      console.error('转换失败:', error);
      setResult({
        success: false,
        message: `转换失败: ${error instanceof Error ? error.message : '未知错误'}`,
      });
      message.error('转换失败，请检查PDF服务是否正在运行');
      setConverting(false);
    }
  };

  // 监听IPC响应
  useEffect(() => {
    const cancel1 = window.electron?.ipcRenderer.on(
      'pdf-convert',
      (messageType: any, data: any) => {
        console.debug('PDF转换响应:', messageType, data);
        
        if (messageType === 'error') {
          setResult({
            success: false,
            message: data,
          });
          message.error(data);
          setConverting(false);
        } else if (messageType === 'data') {
          const { success, message: resultMessage, translationCorrect } = data.data;
          
          setResult({
            success,
            message: resultMessage,
            translationCorrect,
          });

          if (success) {
            message.success('PDF转换成功！');
          } else {
            message.error('PDF转换失败');
          }
          setConverting(false);
        }
      }
    );

    const cancel2 = window.electron?.ipcRenderer.on(
      'select-pdf-files',
      (messageType: any, data: any) => {
        console.debug('文件选择响应:', messageType, data);
        
        if (messageType === 'data') {
          const filePaths = data.data;
          if (filePaths && filePaths.length > 0) {
            // 将文件路径转换为FileItem格式
            const newFiles: FileItem[] = filePaths.map((filePath: string) => ({
              name: filePath.split(/[\\/]/).pop() || filePath, // 获取文件名
              path: filePath
            }));
            
            // 合并到现有文件列表，避免重复
            const existingPaths = fileList.map(f => f.path);
            const uniqueNewFiles = newFiles.filter(f => !existingPaths.includes(f.path));
            
            setFileList([...fileList, ...uniqueNewFiles]);
          }
        } else if (messageType === 'error') {
          message.error(data);
        } else if (messageType === 'warning') {
          message.warning(data);
        }
      }
    );

    return () => {
      if (cancel1) cancel1();
      if (cancel2) cancel2();
    };
  }, [fileList]);

  return (
    <div className="pdf-convert">
      <Card>
        <div className="header">
          <NavLink to="/ai-service">
            <Button>返回</Button>
          </NavLink>
          <Title level={3}>PDF转Markdown</Title>
        </div>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="file-section">
            <div className="file-header">
              <Text strong>选择PDF文件：</Text>
              <Button 
                type="primary" 
                icon={<PlusOutlined />} 
                onClick={handleFileSelect}
                disabled={converting}
              >
                选择PDF文件
              </Button>
            </div>
            
            {fileList.length > 0 && (
              <List
                size="small"
                bordered
                dataSource={fileList}
                renderItem={(file, index) => (
                  <List.Item
                    actions={[
                      <Button
                        key="delete"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeFile(index)}
                        disabled={converting}
                      >
                        删除
                      </Button>
                    ]}
                  >
                    <div className="file-item">
                      <Text>{file.name}</Text>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        {file.path}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            )}
            
            <Text type="secondary">
              支持选择多个PDF文件进行批量转换，文件名中不能携带逗号等特殊符号。
            </Text>
          </div>

          <div className="convert-section">
            <Button
              type="primary"
              size="large"
              icon={<FileTextOutlined />}
              onClick={convertPdfToMarkdown}
              loading={converting}
              disabled={fileList.length === 0}
            >
              {converting ? '转换中...' : '开始转换'}
            </Button>
          </div>

          {result && (
            <div className="result-section">
              <Card
                title="转换结果"
                type="inner"
                className={result.success ? 'success-card' : 'error-card'}
              >
                <Space direction="vertical">
                  <Text strong={result.success}>
                    {result.message}
                  </Text>
                  {result.success && result.translationCorrect !== undefined && (
                    <Text type={result.translationCorrect ? 'success' : 'warning'}>
                      翻译正确性: {result.translationCorrect ? '正确' : '可能存在问题'}
                    </Text>
                  )}
                </Space>
              </Card>
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
} 