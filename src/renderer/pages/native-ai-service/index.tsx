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
import { useDeepseekHarnessServiceShortcut } from '../../containers/use-deepseek-harness-service-shortcut';
import { WorkbuddyModelSyncResult } from '../../../main/deepseek-harness-service/type-info';
import { useState } from 'react';

// OpenClaw 管理界面暂不展示：相关代码全部保留，之后需要重新启用时把这里改成 true 即可
const OPENCLAW_UI_ENABLED = false;

/** 把未知错误转成可展示的文本 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  try {
    return JSON.stringify(error) || '未知错误';
  } catch {
    return String(error);
  }
}

/** 从 WorkBuddy 同步模型配置后的结果展示 */
function WorkbuddySyncResultContent({
  result,
  onOpenBackupDir,
}: {
  result: WorkbuddyModelSyncResult;
  onOpenBackupDir: (dir?: string) => void;
}) {
  return (
    <div className="workbuddy-sync-result">
      <p className="workbuddy-sync-headline">
        已同步 <strong>{result.syncedModelCount}</strong> 个模型，生成{' '}
        <strong>{result.routeCount}</strong> 条提供方路由。
      </p>

      {result.summary.length > 0 && (
        <ul className="workbuddy-sync-summary">
          {result.summary.map((line, index) => (
            // 摘要来自主进程，内容可能重复，用下标做 key
            // eslint-disable-next-line react/no-array-index-key
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}

      <p className="workbuddy-sync-backup">
        {result.backup.dir ? (
          <>
            {result.backup.reused
              ? '同步前的 dsh 配置与上次备份一致，沿用已有备份：'
              : '同步前已备份 dsh 配置到：'}
            <code>{result.backup.dir}</code>
            <Button
              type="link"
              size="small"
              onClick={() => onOpenBackupDir(result.backup.dir ?? undefined)}
            >
              打开备份目录
            </Button>
          </>
        ) : (
          <>dsh 还没有配置文件，本次无需备份。</>
        )}
      </p>

      {result.notices.length > 0 && (
        <p className="workbuddy-sync-notices">
          有 {result.notices.length} 个模型没有同步：
          {result.notices
            .map((notice) => `${notice.name}（${notice.reason}）`)
            .join('、')}
        </p>
      )}

      {result.warnings.map((warning) => (
        <p key={warning} className="workbuddy-sync-notices">
          {warning}
        </p>
      ))}
    </div>
  );
}

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

  const openclawShortcut = useOpenclawServiceShortcut(OPENCLAW_UI_ENABLED);

  const deepseekHarnessShortcut = useDeepseekHarnessServiceShortcut();

  const deepseekHarnessStateText =
    {
      not_install: '未安装',
      installing: '安装中',
      installed: '已安装',
      uninstalling: '卸载中',
    }[deepseekHarnessShortcut.state] || '检测中...';

  const [deepseekHarnessOperating, setDeepseekHarnessOperating] = useState<
    'run' | 'stop' | null
  >(null);

  const installDeepseekHarnessService = async () => {
    try {
      await deepseekHarnessShortcut.install();
    } catch (e) {
      message.error(e.message);
    }
  };

  const removeDeepseekHarnessService = async () => {
    try {
      await deepseekHarnessShortcut.remove();
    } catch (e) {
      message.error(e.message);
    }
  };

  const runDeepseekHarnessService = async () => {
    setDeepseekHarnessOperating('run');
    try {
      await deepseekHarnessShortcut.run();
    } catch (e) {
      message.error(e.message);
    } finally {
      setDeepseekHarnessOperating(null);
    }
  };

  const stopDeepseekHarnessService = async () => {
    setDeepseekHarnessOperating('stop');
    try {
      await deepseekHarnessShortcut.stop();
    } catch (e) {
      message.error(e.message);
    } finally {
      setDeepseekHarnessOperating(null);
    }
  };

  const openDeepseekHarnessWindow = async () => {
    try {
      await deepseekHarnessShortcut.openWindow();
    } catch (e) {
      message.error(e.message);
    }
  };

  const copyDeepseekHarnessPageLink = async () => {
    try {
      await deepseekHarnessShortcut.copyPageLink();
      message.success('页面链接已复制到剪贴板');
    } catch (e) {
      message.error(e.message);
    }
  };

  /** 创建桌面快捷方式：以后双击它就能直接进 dsh，不用先开启动器 */
  const createDshShortcut = async () => {
    await deepseekHarnessShortcut.createShortcut();
  };

  /** 真正执行同步：结果用弹窗展示（写入摘要 + 备份位置），失败给出可读原因 */
  const runSyncWorkbuddyModels = async () => {
    try {
      const result = await deepseekHarnessShortcut.syncWorkbuddyModels();
      Modal.success({
        title: '已从 WorkBuddy 同步模型配置',
        width: 560,
        okText: '好',
        content: (
          <WorkbuddySyncResultContent
            result={result}
            onOpenBackupDir={deepseekHarnessShortcut.openBackupDir}
          />
        ),
      });
    } catch (e) {
      Modal.error({
        title: '同步 WorkBuddy 模型配置失败',
        width: 520,
        okText: '好',
        content: <span>{describeError(e)}</span>,
      });
    }
  };

  /**
   * 同步前的确认：用一句话讲清楚「从哪里读、往哪里写、会先备份」，
   * 让用户点之前就知道会发生什么，而不是点完才发现配置被改了。
   */
  const confirmSyncWorkbuddyModels = () => {
    Modal.confirm({
      title: '从 WorkBuddy 同步模型配置到 DeepSeek Harness？',
      width: 540,
      icon: null,
      okText: '同步',
      cancelText: '取消',
      content: (
        <div className="workbuddy-sync-confirm">
          <p>
            将读取 WorkBuddy 里已配置好的自定义模型，转换成 DeepSeek Harness
            的提供方配置：
          </p>
          <ul>
            <li>
              <strong>模型元信息配置</strong>：写入 <code>settings.yaml</code>
            </li>
            <li>
              <strong>API Key</strong>：写入 <code>.credentials.yaml</code>
            </li>
          </ul>
          <p className="workbuddy-sync-backup">
            写入前会自动把这两个文件整份备份到 dsh 的 <code>backups/</code>
            目录，发生错误时可手动还原；DeepSeek Harness 会热加载新配置，无需重启。
          </p>
        </div>
      ),
      onOk: () => runSyncWorkbuddyModels(),
    });
  };

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
        {OPENCLAW_UI_ENABLED && (
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
        )}
        <List.Item
          actions={[
            deepseekHarnessShortcut.state !== 'installed' && (
              <Button
                key="install-deepseek-harness-service"
                className="rts-button install"
                loading={deepseekHarnessShortcut.state === 'installing'}
                disabled={
                  deepseekHarnessShortcut.state === 'uninstalling' ||
                  deepseekHarnessShortcut.refreshing
                }
                onClick={installDeepseekHarnessService}
              >
                <span className="button-text">安装</span>
              </Button>
            ),
            deepseekHarnessShortcut.state === 'installed' &&
              !deepseekHarnessShortcut.running && (
                <Button
                  key="run-deepseek-harness-service"
                  className="rts-button run"
                  loading={deepseekHarnessOperating === 'run'}
                  disabled={deepseekHarnessOperating === 'stop'}
                  onClick={runDeepseekHarnessService}
                >
                  <span className="button-text">运行</span>
                </Button>
              ),
            deepseekHarnessShortcut.running && (
              <Button
                key="open-deepseek-harness-window"
                className="rts-button run"
                onClick={openDeepseekHarnessWindow}
              >
                <span className="button-text">打开界面</span>
              </Button>
            ),
            deepseekHarnessShortcut.running && (
              <Button
                key="copy-deepseek-harness-page-link"
                onClick={copyDeepseekHarnessPageLink}
              >
                <span className="button-text">复制页面链接</span>
              </Button>
            ),
            deepseekHarnessShortcut.running && (
              <Button
                key="stop-deepseek-harness-service"
                className="rts-button uninstall"
                danger
                loading={deepseekHarnessOperating === 'stop'}
                disabled={deepseekHarnessOperating === 'run'}
                onClick={stopDeepseekHarnessService}
              >
                <span className="button-text">停止</span>
              </Button>
            ),
            (deepseekHarnessShortcut.state === 'installed' ||
              deepseekHarnessShortcut.state === 'uninstalling') &&
              deepseekHarnessShortcut.running === false && (
                <Button
                  key="remove-deepseek-harness-service"
                  className="rts-button uninstall"
                  danger
                  loading={deepseekHarnessShortcut.state === 'uninstalling'}
                  onClick={removeDeepseekHarnessService}
                >
                  <span className="button-text">卸载</span>
                </Button>
              ),
            <Button
              key="refresh-deepseek-harness-service"
              loading={
                deepseekHarnessShortcut.initing ||
                deepseekHarnessShortcut.refreshing
              }
              onClick={deepseekHarnessShortcut.refresh}
            >
              刷新状态
            </Button>,
            deepseekHarnessShortcut.state === 'installed' && (
              <Button
                key="sync-workbuddy-models"
                loading={deepseekHarnessShortcut.syncingWorkbuddyModels}
                // 只在这里渲染（state 必为 installed），所以只需避开刷新中的状态
                disabled={deepseekHarnessShortcut.refreshing}
                onClick={confirmSyncWorkbuddyModels}
              >
                <span className="button-text">同步 WorkBuddy 模型</span>
              </Button>
            ),
            deepseekHarnessShortcut.state === 'installed' && (
              <Button
                key="create-dsh-shortcut"
                title="在桌面创建快捷方式，双击直接启动 DeepSeek Harness（不打开启动器主界面）"
                loading={deepseekHarnessShortcut.creatingShortcut}
                disabled={deepseekHarnessShortcut.refreshing}
                onClick={createDshShortcut}
              >
                <span className="button-text">创建桌面快捷方式</span>
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="DeepSeek Harness"
            description={`DeepSeek 智能体工作台 服务状态：${deepseekHarnessStateText}${
              deepseekHarnessShortcut.running ? '（运行中）' : ''
            }${
              deepseekHarnessShortcut.port
                ? `（端口 ${deepseekHarnessShortcut.port}）`
                : ''
            }${
              deepseekHarnessShortcut.version
                ? ` 版本：${deepseekHarnessShortcut.version}`
                : ''
            }`}
          />
        </List.Item>
      </List>
      {/* 高度交给容器自适应：占满列表下方的剩余空间 */}
      <TerminalLogScreen
        id="native-ai-terminal-log"
        style={{ width: 'calc(100% - 20px)', marginTop: '16px' }}
      />
    </div>
  );
}
