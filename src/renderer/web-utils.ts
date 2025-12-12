export interface LogEntry {
  id: string;
  level: 'info' | 'warning' | 'error' | 'success';
  timestamp: string;
  message: string;
}

export const downloadLogsAsText = (text: string, fileName: string) => {
  // 创建Blob对象
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;

  // 触发下载
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 清理URL对象
  URL.revokeObjectURL(url);
};