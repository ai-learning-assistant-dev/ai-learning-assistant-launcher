import {
  Button,
  List,
  Modal,
  notification,
  Popconfirm,
  Progress,
  Typography,
} from 'antd';
import { useObsidianVoiceService } from '../../containers/use-obsidian-voice-service';
import { Link } from 'react-router-dom';
import { useRtsService } from '../../containers/use-rts-service';

import toolsIcon from './Tools_Icon.png';

export default function NativeAiService() {
  const {
    voiceState,
    voiceLoading,
    voiceOperation,
    installVoiceService,
    runVoiceService,
    stopVoiceService,
    refreshVoiceStatus,
  } = useObsidianVoiceService();

  // 使用 RTS 服务 hook
  const {
    rtsState,
    rtsLoading,
    rtsProgress,
    rtsOperation,
    rtsStageMessage,
    rtsErrorMessage,
    clearRtsError,
    installRts,
    runRts,
    stopRts,
  } = useRtsService();

  return (
    <div className="native-ai-service">
      <List
        className="native-ai-service-list"
        header={
          <div className="header-container">
            <Link to="/hello">
              <Button>返回</Button>
            </Link>
          </div>
        }
        bordered
      >
        <List.Item
          actions={[
            (voiceState === 'not_installed' || !voiceState) && (
              <Button
                key="install-voice-service"
                loading={
                  voiceLoading &&
                  voiceOperation === 'install' &&
                  voiceState === 'starting'
                }
                onClick={installVoiceService}
              >
                安装语音服务
              </Button>
            ),
            voiceState !== 'running' && (
              <Button
                key="run-voice-service"
                type="primary"
                loading={
                  voiceLoading &&
                  voiceOperation === 'run' &&
                  voiceState === 'starting'
                }
                onClick={runVoiceService}
              >
                启动语音服务
              </Button>
            ),
            (voiceState === 'running' || voiceState === 'starting') && (
              <Button
                key="stop-voice-service"
                danger
                loading={
                  voiceLoading &&
                  voiceOperation === 'stop' &&
                  voiceState === 'starting'
                }
                onClick={stopVoiceService}
              >
                停止语音服务
              </Button>
            ),
            <Button
              key="refresh-voice-service"
              loading={voiceLoading && voiceState === 'starting'}
              onClick={refreshVoiceStatus}
            >
              刷新状态
            </Button>,
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="Obsidian Voice Service"
            description={`服务状态：${voiceState || 'unknown'}（端口 8001）`}
          />
        </List.Item>
        <List.Item>
          <div className="rts-section">
            <div className="rts-container">
              <div className="rts-wrapper">
                <div className="rts-content-wrapper">
                  <div className="rts-header">
                    <img className="rts-logo" src={toolsIcon} alt="RTS Logo" />
                    <span className="rts-title">RTS</span>
                  </div>
                  <p className="rts-description">
                    实时语音服务，为工具箱(本地化)提供语音识别和语音合成功能
                  </p>
                  <div className="rts-status-container">
                    <span
                      className={`rts-status-badge ${
                        rtsState === 'running'
                          ? 'running'
                          : rtsState === 'error'
                            ? 'error'
                            : rtsState === 'starting'
                              ? 'starting'
                              : rtsState === 'stopped'
                                ? 'stopped'
                                : ''
                      }`}
                    >
                      {rtsState === 'running'
                        ? '运行中'
                        : rtsState === 'error'
                          ? '错误'
                          : rtsState === 'starting'
                            ? '启动中'
                            : rtsState === 'stopped'
                              ? '已停止'
                              : rtsState === 'not_installed'
                                ? '未安装'
                                : '检测中...'}
                    </span>
                  </div>
                </div>
                {/* 路径过长错误提示 */}
                {rtsErrorMessage && (
                  <div className="rts-error-message">
                    <div className="rts-error-content">
                      <span className="rts-error-icon">⚠️</span>
                      <span className="rts-error-text">{rtsErrorMessage}</span>
                    </div>
                    <button className="rts-error-close" onClick={clearRtsError}>
                      ×
                    </button>
                  </div>
                )}
                <div className="rts-buttons-wrapper">
                  {rtsLoading && rtsProgress > 0 && (
                    <div className="rts-progress-inline">
                      <Progress
                        percent={rtsProgress}
                        size="small"
                        showInfo={true}
                        status={rtsProgress === 100 ? 'success' : 'active'}
                        format={(percent) => `${percent}%`}
                      />
                      {rtsStageMessage && (
                        <span className="rts-loading-hint">
                          {rtsStageMessage}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 安装按钮：未安装或状态未知时显示 */}
                  {(!rtsState ||
                    rtsState === '' ||
                    rtsState === 'not_installed') && (
                    <Button
                      className="rts-button install"
                      onClick={installRts}
                      loading={rtsLoading && rtsOperation === 'install'}
                      disabled={rtsLoading && rtsOperation !== 'install'}
                    >
                      <span className="button-text">安装</span>
                    </Button>
                  )}
                  {/* 启动按钮：已停止或错误时显示 */}
                  {(rtsState === 'stopped' || rtsState === 'error') && (
                    <Button
                      className="rts-button run"
                      onClick={runRts}
                      loading={rtsLoading && rtsOperation === 'run'}
                      disabled={rtsLoading && rtsOperation !== 'run'}
                    >
                      <span className="button-text">启动</span>
                    </Button>
                  )}
                  {/* 停止按钮：运行中或启动中时显示 */}
                  {(rtsState === 'running' || rtsState === 'starting') && (
                    <Button
                      className="rts-button uninstall"
                      onClick={stopRts}
                      loading={rtsLoading && rtsOperation === 'stop'}
                      disabled={rtsLoading && rtsOperation !== 'stop'}
                    >
                      <span className="button-text">停止</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </List.Item>
      </List>
    </div>
  );
}
