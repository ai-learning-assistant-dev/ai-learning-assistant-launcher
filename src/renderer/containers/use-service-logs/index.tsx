import { useState, useCallback } from 'react';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'success';
  service: string;
  message: string;
}

export default function useServiceLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsVisible, setIsLogsVisible] = useState(false);

  const addLog = useCallback((level: LogEntry['level'], service: string, message: string) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      level,
      service,
      message,
    };
    
    setLogs(prevLogs => {
      // 保持最新的100条日志
      const updatedLogs = [newLog, ...prevLogs].slice(0, 100);
      return updatedLogs;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const toggleLogsVisibility = useCallback(() => {
    setIsLogsVisible(prev => !prev);
  }, []);

  return {
    logs,
    isLogsVisible,
    addLog,
    clearLogs,
    toggleLogsVisibility,
  };
} 