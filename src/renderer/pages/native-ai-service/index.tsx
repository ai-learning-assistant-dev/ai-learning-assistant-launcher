import {
  Button,
  List,
  message,
  Modal,
  notification,
  Popconfirm,
  Progress,
  Typography,
} from 'antd';
import { useObsidianVoiceService } from '../../containers/use-obsidian-voice-service';
import { Link } from 'react-router-dom';
import { useRtsService } from '../../containers/use-rts-service';
import './index.scss';
import { TerminalLogScreen } from '../../containers/terminal-log-screen';
import { useTextbookEditorServiceShortcut } from '../../containers/use-textbook-editor-service-shortcut';
import { useOpenclawServiceShortcut } from '../../containers/use-openclaw-service-shortcut';
import { useState } from 'react';

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

  const textbookEditorShortcut = useTextbookEditorServiceShortcut();
  const [textbookEditorServiceStarting, setTextbookEditorServiceStarting] =
    useState(false);

  const openclawShortcut = useOpenclawServiceShortcut();

  const openclawStateText =
    {
      not_install: '未安装',
      installing: '安装中',
      installed: '已安装',
      uninstalling: '卸载中',
    }[openclawShortcut.state] || '检测中...';

  const installOpenclawService = async () => {
    try {
      await openclawShortcut.install();
    } catch (e) {
      message.error(e.message);
    }
  };

  const removeOpenclawService = async () => {
    try {
      await openclawShortcut.remove();
    } catch (e) {
      message.error(e.message);
    }
  };

  const [openclawOperating, setOpenclawOperating] = useState<
    'run' | 'stop' | null
  >(null);

  const runOpenclawService = async () => {
    setOpenclawOperating('run');
    try {
      await openclawShortcut.run();
    } catch (e) {
      message.error(e.message);
    } finally {
      setOpenclawOperating(null);
    }
  };

  const stopOpenclawService = async () => {
    setOpenclawOperating('stop');
    try {
      await openclawShortcut.stop();
    } catch (e) {
      message.error(e.message);
    } finally {
      setOpenclawOperating(null);
    }
  };

  const openOpenclawWindow = async () => {
    try {
      await openclawShortcut.openWindow();
    } catch (e) {
      message.error(e.message);
    }
  };

  const copyOpenclawPageLink = async () => {
    try {
      await openclawShortcut.copyPageLink();
      message.success('页面链接已复制到剪贴板');
    } catch (e) {
      message.error(e.message);
    }
  };

  const openTextbookEditorService = async () => {
    setTextbookEditorServiceStarting(true);
    try {
      await textbookEditorShortcut.start();
    } catch (e) {
      message.error(e.message);
    }
    setTextbookEditorServiceStarting(false);
  };

  const [textbookEditorServiceRemoving, setTextbookEditorServiceRemoving] =
    useState(false);
  const removeTextbookEditorService = async () => {
    setTextbookEditorServiceRemoving(true);
    await textbookEditorShortcut.remove();
    setTextbookEditorServiceRemoving(false);
  };

  const updateTextbookEditorService = async () => {
    setTextbookEditorServiceStarting(true);
    setTextbookEditorServiceRemoving(true);
    await textbookEditorShortcut.update();
    message.success('学科培训编辑器更新成功');
    setTextbookEditorServiceStarting(false);
    setTextbookEditorServiceRemoving(false);
  };

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
                className="rts-button install"
                loading={
                  voiceLoading &&
                  voiceOperation === 'install' &&
                  voiceState === 'starting'
                }
                onClick={installVoiceService}
              >
                <span className="button-text">安装</span>
              </Button>
            ),
            voiceState !== 'running' && (
              <Button
                key="run-voice-service"
                className="rts-button run"
                loading={
                  voiceLoading &&
                  voiceOperation === 'run' &&
                  voiceState === 'starting'
                }
                onClick={runVoiceService}
              >
                <span className="button-text">启动</span>
              </Button>
            ),
            (voiceState === 'running' || voiceState === 'starting') && (
              <Button
                key="stop-voice-service"
                className="rts-button uninstall"
                danger
                loading={
                  voiceLoading &&
                  voiceOperation === 'stop' &&
                  voiceState === 'starting'
                }
                onClick={stopVoiceService}
              >
                <span className="button-text">停止</span>
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
            title="Obsidian 语音服务"
            description={`为Obsidian提供文字语音互转服务 服务状态：${voiceState || 'unknown'}（端口 8001）`}
          />
        </List.Item>
        <List.Item
          actions={[
            (!rtsState || rtsState === '' || rtsState === 'not_installed') && (
              <Button
                className="rts-button install"
                onClick={installRts}
                loading={rtsLoading && rtsOperation === 'install'}
                disabled={rtsLoading && rtsOperation !== 'install'}
              >
                <span className="button-text">安装</span>
              </Button>
            ),
            (rtsState === 'stopped' || rtsState === 'error') && (
              <Button
                className="rts-button run"
                onClick={runRts}
                loading={rtsLoading && rtsOperation === 'run'}
                disabled={rtsLoading && rtsOperation !== 'run'}
              >
                <span className="button-text">启动</span>
              </Button>
            ),
            (rtsState === 'running' || rtsState === 'starting') && (
              <Button
                className="rts-button uninstall"
                onClick={stopRts}
                loading={rtsLoading && rtsOperation === 'stop'}
                disabled={rtsLoading && rtsOperation !== 'stop'}
              >
                <span className="button-text">停止</span>
              </Button>
            ),
          ].filter((item) => item)}
        >
          <div className="rts-wrapper">
            <div className="rts-content-wrapper">
              <div className="rts-header">
                <span className="rts-title">语音对话</span>
              </div>
              <p className="rts-description">为学科培训提供实时语音对话服务</p>
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
                    <span className="rts-loading-hint">{rtsStageMessage}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </List.Item>
        <List.Item
          actions={[
            !(
              (textbookEditorShortcut.state === 'stopped' ||
                textbookEditorShortcut.state === 'updating') &&
              textbookEditorShortcut.programVersionInfo.haveNew
            ) && (
              <Button
                className="rts-button run"
                onClick={openTextbookEditorService}
                loading={
                  textbookEditorServiceStarting ||
                  textbookEditorShortcut.initing
                }
                disabled={textbookEditorServiceRemoving}
              >
                <span className="button-text">
                  {textbookEditorShortcut.state === 'not_install'
                    ? '安装'
                    : '开始'}
                </span>
              </Button>
            ),
            (textbookEditorShortcut.state === 'stopped' ||
              textbookEditorShortcut.state === 'updating') &&
              textbookEditorShortcut.programVersionInfo.haveNew && (
                <Button
                  className="rts-button install"
                  onClick={updateTextbookEditorService}
                  loading={textbookEditorServiceRemoving}
                >
                  <span className="button-text">更新</span>
                </Button>
              ),
            textbookEditorShortcut.state !== 'not_install' && (
              <Button
                className="rts-button uninstall"
                onClick={removeTextbookEditorService}
                loading={textbookEditorServiceRemoving}
              >
                <span className="button-text">卸载</span>
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="学科培训课程编辑器"
            description={`为学科培训提供课程编辑功能 服务状态：${textbookEditorShortcut.state || 'unknown'}（端口 7200）`}
          />
        </List.Item>
        <List.Item
          actions={[
            openclawShortcut.state !== 'installed' && (
              <Button
                key="install-openclaw-service"
                className="rts-button install"
                loading={openclawShortcut.state === 'installing'}
                disabled={openclawShortcut.state === 'uninstalling'}
                onClick={installOpenclawService}
              >
                <span className="button-text">安装</span>
              </Button>
            ),
            openclawShortcut.state === 'installed' &&
              !openclawShortcut.running && (
                <Button
                  key="run-openclaw-service"
                  className="rts-button run"
                  loading={openclawOperating === 'run'}
                  disabled={openclawOperating === 'stop'}
                  onClick={runOpenclawService}
                >
                  <span className="button-text">运行</span>
                </Button>
              ),
            openclawShortcut.running && (
              <Button
                key="open-openclaw-window"
                className="rts-button run"
                onClick={openOpenclawWindow}
              >
                <span className="button-text">打开界面</span>
              </Button>
            ),
            openclawShortcut.running && (
              <Button
                key="copy-openclaw-page-link"
                onClick={copyOpenclawPageLink}
              >
                <span className="button-text">复制页面链接</span>
              </Button>
            ),
            openclawShortcut.running && (
              <Button
                key="stop-openclaw-service"
                className="rts-button uninstall"
                danger
                loading={openclawOperating === 'stop'}
                disabled={openclawOperating === 'run'}
                onClick={stopOpenclawService}
              >
                <span className="button-text">停止</span>
              </Button>
            ),
            (openclawShortcut.state === 'installed' ||
              openclawShortcut.state === 'uninstalling') &&
              openclawShortcut.running === false && (
                <Button
                  key="remove-openclaw-service"
                  className="rts-button uninstall"
                  danger
                  loading={openclawShortcut.state === 'uninstalling'}
                  onClick={removeOpenclawService}
                >
                  <span className="button-text">卸载</span>
                </Button>
              ),
            <Button
              key="refresh-openclaw-service"
              loading={openclawShortcut.initing}
              onClick={openclawShortcut.refresh}
            >
              刷新状态
            </Button>,
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="OpenClaw"
            description={`AI助理 服务状态：${openclawStateText}${
              openclawShortcut.running ? '（运行中）' : ''
            }${
              openclawShortcut.version
                ? ` 版本：${openclawShortcut.version}`
                : ''
            }`}
          />
        </List.Item>
      </List>
      <TerminalLogScreen
        id="native-ai-terminal-log"
        cols={100}
        rows={26}
        style={{
          width: 'calc(100% - 20px)',
          marginTop: '16px',
          height: '340px',
        }}
      />
    </div>
  );
}
