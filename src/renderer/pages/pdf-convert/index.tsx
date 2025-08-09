import { Button, message, Card, Typography, Space, List, Tag, Tooltip } from 'antd';
import { FileTextOutlined, PlusOutlined, DeleteOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { TerminalLogScreen } from '../../containers/terminal-log-screen';
import './index.scss';

const { Title, Text } = Typography;

interface ConversionResult {
  success: boolean;
  message: string;
}

interface FileItem {
  name: string;
  path: string;
  status?: 'pending' | 'converting' | 'success' | 'failed';
  error?: string;
}

interface ProgressData {
  taskId: string;
  total: number;
  completed: number;
  successful: number;
  failed: number;
  currentFile: string;
  message: string;
}

export default function PdfConvert() {
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [backgroundTask, setBackgroundTask] = useState<string | null>(null);
  const [hasRunningTasks, setHasRunningTasks] = useState(false);
  const [isTaskSubmitted, setIsTaskSubmitted] = useState(false);
  const [progressData, setProgressData] = useState<ProgressData | null>(null);

  // 渲染文件状态图标和标签
  const renderFileStatus = (file: FileItem) => {
    switch (file.status) {
      case 'converting':
        return (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            转换中
          </Tag>
        );
      case 'failed':
        return (
          <Tooltip title={file.error || '转换失败'}>
            <Tag icon={<CloseCircleOutlined />} color="error">
              失败
            </Tag>
          </Tooltip>
        );
      case 'success':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            完成
          </Tag>
        );
      case 'pending':
      default:
        return (
          <Tag color="default">
            待处理
          </Tag>
        );
    }
  };

  // 移除文件函数，只能移除非转换中的文件
  const removeFile = (index: number) => {
    const file = fileList[index];
    if (file.status === 'converting') {
      message.warning('正在转换中的文件无法删除');
      return;
    }
    const newFileList = fileList.filter((_, i) => i !== index);
    setFileList(newFileList);
  };

  // 页面加载时恢复状态
  useEffect(() => {
    // 请求恢复持久化状态
    window.electron.ipcRenderer.sendMessage('pdf-convert', 'check', 'PDF');
  }, []);

  const handleFileSelect = async () => {
    try {
      // 通过IPC调用主进程的文件选择对话框
      window.electron.ipcRenderer.sendMessage('pdf-convert', 'select');
    } catch (error) {
      console.error('选择文件失败:', error);
      message.error('选择文件失败');
    }
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
      setIsTaskSubmitted(false);
      setHasRunningTasks(false);
      setBackgroundTask(null);
    }
  };

  // 监听IPC响应
  useEffect(() => {
    const cancelByPdfConvert = window.electron?.ipcRenderer.on(
      'pdf-convert',
      (messageType: any, data: any) => {
        console.debug('PDF转换响应:', messageType, data);
        
        // 处理状态恢复响应
        if (messageType === 'data' && data.action === 'check') {
          const { fileList: persistedFileList, lastResult, runningTasks } = data.data;
          
          if (persistedFileList && persistedFileList.length > 0) {
            setFileList(persistedFileList);
          }
          
          if (lastResult) {
            setResult(lastResult);
          }
          
          // 检查是否有正在运行的任务
          if (runningTasks && runningTasks.taskId) {
            setHasRunningTasks(true);
            setConverting(true);
            setBackgroundTask(runningTasks.taskId);
            console.log(`发现正在运行的后台任务: ${runningTasks.taskId}`);
          } else {
            setHasRunningTasks(false);
            setConverting(false);
            setBackgroundTask(null);
          }
          
          return;
        }
        
        // 处理PDF转换响应
        if (messageType === 'data' && data.action === 'convert') {
          const { taskId, status, message: resultMessage } = data.data;
          
          if (status === 'started') {
            setBackgroundTask(taskId);
            setConverting(true);
            setIsTaskSubmitted(true);
            setHasRunningTasks(true);
            message.info(resultMessage);
            return;
          }
          
          // 处理转换完成
          const { success, convertedFiles } = data.data;
          
          setResult({
            success,
            message: resultMessage,
          });

          if (success) {
            message.success('PDF转换成功！');
            // 从文件列表中移除已转换的文件
            if (convertedFiles && convertedFiles.length > 0) {
              setFileList(prevFiles => 
                prevFiles.filter(file => !convertedFiles.includes(file.path))
              );
            }
          } else {
            message.error('PDF转换失败');
          }
          setConverting(false);
          setBackgroundTask(null);
        }
        // 处理文件选择响应
        else if (messageType === 'data' && data.action === 'select') {
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
        }
        // 处理错误响应
        else if (messageType === 'error') {
          if (converting) {
            setResult({
              success: false,
              message: data,
            });
            message.error(data);
            setConverting(false);
            setIsTaskSubmitted(false);
            setHasRunningTasks(false);
            setBackgroundTask(null);
          } else {
            message.error(data);
          }
        }
        // 处理警告响应
        else if (messageType === 'warning') {
          message.warning(data);
        }
      }
    );

    // 监听后台任务完成通知和文件状态更新
    const cancelByBackgroundTask = window.electron?.ipcRenderer.on(
      'pdf-convert-completed',
      (data: any) => {
        console.debug('PDF转换事件:', data);
        
        // 处理文件状态更新
        if (data.fileList !== undefined && data.updatedFile) {
          console.debug('文件状态更新:', data.updatedFile);
          setFileList(data.fileList);
          return;
        }
        
        // 处理转换完成
        if (data.taskId) {
          console.debug('后台转换完成:', data);
          
          setResult({
            success: data.success,
            message: data.message,
          });

          if (data.success) {
            message.success('后台PDF转换成功！');
          } else {
            message.error('后台PDF转换失败');
          }
          
          setConverting(false);
          setBackgroundTask(null);
          setIsTaskSubmitted(false);
          setHasRunningTasks(false);
          setProgressData(null);
        }
      }
    );

    // 监听转换进度更新
    const cancelByProgress = window.electron?.ipcRenderer.on(
      'pdf-convert-progress' as any,
      (messageType: any, data: any) => {
        console.debug('转换进度更新:', data);
        setProgressData(data as ProgressData);
      }
    );

    return () => {
      if (cancelByPdfConvert) cancelByPdfConvert();
      if (cancelByBackgroundTask) cancelByBackgroundTask();
      if (cancelByProgress) cancelByProgress();
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
                disabled={converting || hasRunningTasks}
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
                        disabled={converting || hasRunningTasks || file.status === 'converting'}
                      >
                        删除
                      </Button>
                    ]}
                  >
                    <div className="file-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text>{file.name}</Text>
                        {renderFileStatus(file)}
                      </div>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        {file.path}
                      </Text>
                      {file.status === 'failed' && file.error && (
                        <Text type="danger" style={{ fontSize: '12px' }}>
                          错误: {file.error}
                        </Text>
                      )}
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
              disabled={fileList.length === 0 || isTaskSubmitted || hasRunningTasks}
            >
              {converting ? (backgroundTask ? '后台转换中...' : '转换中...') : '开始转换'}
            </Button>
            {(backgroundTask || hasRunningTasks) && (
              <div style={{ marginTop: '8px' }}>
                {backgroundTask && (
                  <Text type="secondary" style={{ display: 'block' }}>
                    任务ID: {backgroundTask.slice(0, 8)}... (可离开页面，转换在后台继续)
                  </Text>
                )}
                {hasRunningTasks && !isTaskSubmitted && (
                  <Text type="warning" style={{ display: 'block' }}>
                    检测到后台转换任务正在运行，请等待完成
                  </Text>
                )}
                {progressData && (
                  <div style={{ marginTop: '8px' }}>
                    <Text strong style={{ display: 'block' }}>
                      转换进度: {progressData.completed}/{progressData.total}
                    </Text>
                    <Text style={{ display: 'block', color: '#52c41a' }}>
                      成功: {progressData.successful} 个
                    </Text>
                    <Text style={{ display: 'block', color: '#ff4d4f' }}>
                      失败: {progressData.failed} 个
                    </Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      当前处理: {progressData.currentFile}
                    </Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      {progressData.message}
                    </Text>
                  </div>
                )}
              </div>
            )}
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
                </Space>
              </Card>
            </div>
          )}
        </Space>
      </Card>
      
      <TerminalLogScreen
        id="terminal-log"
        cols={100}
        rows={6}
        style={{ width: 'calc(100% - 20px)', marginTop: '16px' }}
      />
    </div>
  );
} 