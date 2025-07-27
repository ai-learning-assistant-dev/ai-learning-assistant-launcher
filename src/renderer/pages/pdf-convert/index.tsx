import { Button, Upload, message, Card, Typography, Space, Spin } from 'antd';
import { UploadOutlined, FileTextOutlined } from '@ant-design/icons';
import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './index.scss';

const { Title, Text } = Typography;

interface ConversionResult {
  success: boolean;
  message: string;
  translationCorrect?: boolean;
}

export default function PdfConvert() {
  const [fileList, setFileList] = useState<any[]>([]);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);

  const handleFileSelect = (info: any) => {
    const { fileList: newFileList } = info;
    
    // 只允许选择PDF文件
    const validFiles = newFileList.filter((file: any) => {
      const isPDF = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
      if (!isPDF) {
        message.error(`${file.name} 不是PDF文件`);
      }
      return isPDF;
    });

    setFileList(validFiles);
  };

  const convertPdfToMarkdown = async () => {
    if (fileList.length === 0) {
      message.warning('请先选择PDF文件');
      return;
    }

    setConverting(true);
    setResult(null);

    try {
      // 获取文件路径 - 尝试多种方式
      const filePaths = fileList.map((file) => {
        console.debug('文件对象:', file);
        console.debug('originFileObj:', file.originFileObj);
        
        // 尝试多种方式获取文件路径
        const path = file.originFileObj?.path || 
                    file.originFileObj?.name || 
                    file.name ||
                    file.path;
        
        console.debug('获取到的路径:', path);
        return path;
      }).filter(path => path && path !== 'undefined');
      
      console.debug('最终文件路径列表:', filePaths);
      
      if (filePaths.length === 0) {
        throw new Error('无法获取有效的文件路径');
      }
      
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
    const cancel = window.electron?.ipcRenderer.on(
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

    return () => {
      if (cancel) cancel();
    };
  }, []);

  const uploadProps = {
    beforeUpload: () => false, // 阻止自动上传
    onChange: handleFileSelect,
    fileList,
    accept: '.pdf',
    multiple: true,
  };

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
          <div className="upload-section">
            <Text strong>选择PDF文件：</Text>
            <Upload {...uploadProps} listType="text">
              <Button icon={<UploadOutlined />}>选择PDF文件</Button>
            </Upload>
            <Text type="secondary">
              支持选择多个PDF文件进行批量转换
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

          <div className="info-section">
            <Card title="使用说明" type="inner">
              <Space direction="vertical">
                <Text>• 支持PDF文件转换为Markdown格式</Text>
                <Text>• 自动检测翻译正确性</Text>
                <Text>• 支持表格和公式解析</Text>
                <Text>• 请确保PDF服务正在运行（端口5000）</Text>
              </Space>
            </Card>
          </div>
        </Space>
      </Card>
    </div>
  );
} 