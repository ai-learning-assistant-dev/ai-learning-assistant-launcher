import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Form,
  Input,
  Select,
  Switch,
  Card,
  message,
  Space,
  Typography,
  Tag,
  InputNumber,
  Tooltip,
} from 'antd';
import type {
  FreeProviderConfig,
  FreeProviderStatus,
} from '../../../main/llm-free/type-info';

const { Text } = Typography;

/** 探测状态，导出供上方模型列表复用，统一免费模型的可用状态表达。
 * 键名应该与 probe.js 的 STATE 取值一致：
 *  'available' / 'region-blocked' / 'unavailable' / 'throttled' / 'unknown'）。
 **/
export const STATE_META: Record<string, { label: string; color: string }> = {
  available: { label: '可用', color: 'success' },
  throttled: { label: '可用（限流）', color: 'success' },
  // 探测未得出结论的模型，按 DSH 设计仍保留在转发代理中（实际可用），故归为绿色。
  unknown: { label: '可用（未确认）', color: 'success' },
  'region-blocked': { label: '区域受限', color: 'warning' },
  unavailable: { label: '不可用', color: 'error' },
};

const EFFORT_OPTIONS = [
  { value: 'light', label: 'Light（轻量）' },
  { value: 'balanced', label: 'Balanced（均衡）' },
  { value: 'deep', label: 'Deep（深度）' },
];

const FINGERPRINT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'minimal', label: 'Minimal' },
];

/**
 * 免密免费模型（Zen free lane）配置面板状态与行为声明。
 *
 */
export interface ZenFreeProviderController {
  config: FreeProviderConfig | null;
  status: FreeProviderStatus | null;
  loading: boolean;
  // Loading Flag，这是一个修饰交互状态的加载动画是否表现的开关。
  busy: boolean;
  /** 配置本地 setter（供面板内输入框做即时乐观更新，无需每次按键都落盘） */
  setConfig: React.Dispatch<React.SetStateAction<FreeProviderConfig | null>>;
  refresh: () => void;
  patch: (p: Partial<FreeProviderConfig>) => void;
  refreshCatalog: () => void;
  probe: () => void;
  regenerateKey: () => void;
}

export function useZenFreeProvider(): ZenFreeProviderController {
  const [config, setConfig] = useState<FreeProviderConfig | null>(null);
  const [status, setStatus] = useState<FreeProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef<(() => void) | null>(null);
  /** 探测完成是否完成的状态：置为非 0 即启动一次轮询，归零表示不再监视。 */
  const [watchStart, setWatchStart] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, st] = await Promise.all([
        window.mainHandle.llmFreeQueryConfig(),
        window.mainHandle.llmFreeStatus(),
      ]);
      setConfig(cfg);
      setStatus(st);
    } catch (e) {
      message.error(`读取免密免费模型配置失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback(
    async (p: Partial<FreeProviderConfig>) => {
      setBusy(true);
      const startingProxy = p.enabled === true;
      const notice = startingProxy
        ? message.info(
            '正在启动转发代理并探测模型可用性，请稍候。',
            0,
          )
        : null;
      // 交给轮询在探测真正结束时关闭，失败路径下面会直接关掉。
      if (startingProxy) {
        noticeRef.current = notice;
        setWatchStart((n) => n + 1);
      }
      try {
        const next = await window.mainHandle.llmFreeSetConfig(p);
        setConfig(next);
        await refresh();
        // 启停是异步的（转发代理 + catalog/probe 在主进程后台跑），稍后再刷一次拿到最终状态。
        if ('enabled' in p) {
          setTimeout(() => void refresh(), 1500);
        }
      } catch (e) {
        message.error(`保存免密免费模型配置失败: ${(e as Error).message}`);
        notice?.();
        noticeRef.current = null;
        setWatchStart(0);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  /**
   * 等 `start()` 结束后关掉等待提示，并告知用户最终同步了多少个模型。
   *
   */
  useEffect(() => {
    if (watchStart === 0) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const st = await window.mainHandle.llmFreeStatus();
          setStatus(st);
          if (st.startingUp) return; // 还在探测，继续等
          clearInterval(timer);
          noticeRef.current?.(); // 关掉等待提示
          noticeRef.current = null;
          setWatchStart(0);
          const count = st.models.filter((m) => m.state === 'available').length;
          message.success(
            `免费模型已就绪：${st.models.length} 个模型已写入配置，其中 ${count} 个本轮探测为可用。`,
            8,
          );
        } catch {
          // 状态读取失败就继续轮询，等startingUp 自然翻转
        }
      })();
    }, 1500);
    return () => clearInterval(timer);
  }, [watchStart]);

  const refreshCatalog = useCallback(async () => {
    setBusy(true);
    try {
      await window.mainHandle.llmFreeCatalog();
      message.success('已刷新模型目录');
      await refresh();
    } catch (e) {
      message.error(`刷新目录失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      await window.mainHandle.llmFreeProbe();
      message.success('已重新探测可用性');
      await refresh();
    } catch (e) {
      message.error(`探测失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const regenerateKey = useCallback(async () => {
    setBusy(true);
    try {
      const key = await window.mainHandle.llmFreeRegenerateKey();
      message.success('已重新生成转发密钥');
      setConfig((c) => (c ? { ...c, forward: { ...c.forward, key } } : c));
      await refresh();
    } catch (e) {
      message.error(`生成密钥失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { config, status, loading, busy, setConfig, refresh, patch, refreshCatalog, probe, regenerateKey };
}

/**
 * 免密免费模型（Zen free lane）配置面板。
 *
 * - 管理配置并提供一个本地 OpenAI 兼容转发代理；「状态点 + 转发密钥」。
 * - `embedded` 为 true 时（被放进弹窗）不渲染外层 Card 标题，避免与弹窗标题重复。
 */
interface ZenFreeProviderConfigProps {
  controller: ZenFreeProviderController;
  embedded?: boolean;
}

const ZenFreeProviderConfig: React.FC<ZenFreeProviderConfigProps> = ({ controller, embedded = false }) => {
  const { config, status, loading, busy, setConfig, refresh, patch, refreshCatalog, probe, regenerateKey } = controller;

  if (!config) {
    return (
      <Card title="免密免费模型（Zen free lane）" size="small" loading={loading}>
        <div />
      </Card>
    );
  }

  const running = status?.running === true;
  const dotColor = !config.enabled ? '#8c8c8c' : running ? '#52c41a' : '#f5222d';
  const baseUrl = `http://${config.forward.host}:${status?.port || config.forward.port}/v1`;
  const models = status?.models ?? [];

  const body = (
    <>
      <Form layout="vertical" size="small">
        <Form.Item label="启用模型本地转发代理">
          <Switch
            checked={config.enabled}
            loading={busy}
            onChange={(checked) => void patch({ enabled: checked })}
          />
        </Form.Item>

        <Form.Item label="网关基地址" tooltip="Zen 网关地址，可用镜像覆盖；鉴权由启动器内部处理">
          <Input
            value={config.upstream}
            disabled={busy}
            onChange={(e) => setConfig({ ...config, upstream: e.target.value })}
            onBlur={() => void patch({ upstream: config.upstream })}
          />
        </Form.Item>

        <Space size={16} style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Form.Item label="默认推理力度">
            <Select
              style={{ width: 200 }}
              value={config.defaultEffort}
              options={EFFORT_OPTIONS}
              onChange={(v) => void patch({ defaultEffort: v })}
            />
          </Form.Item>
          <Form.Item label="指纹模式">
            <Select
              style={{ width: 220 }}
              value={config.fingerprintMode}
              options={FINGERPRINT_OPTIONS}
              onChange={(v) => void patch({ fingerprintMode: v })}
            />
          </Form.Item>
          <Form.Item label="单回合输出上限 (token)">
            <InputNumber
              min={1024}
              max={262144}
              step={1024}
              value={config.defaultMaxTokens}
              onChange={(v) => v != null && void patch({ defaultMaxTokens: v })}
            />
          </Form.Item>
        </Space>

        <Space size={24} style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Form.Item label="展示区域受限模型">
            <Switch
              checked={config.exposeRegionModels}
              onChange={(checked) => void patch({ exposeRegionModels: checked })}
            />
          </Form.Item>
          <Form.Item label="允许纯推理续写恢复">
            <Switch
              checked={config.streamRecovery}
              onChange={(checked) => void patch({ streamRecovery: checked })}
            />
          </Form.Item>
        </Space>

        <Form.Item label="模型白名单" tooltip="为空表示放行所有可用模型；仅从当前可用模型中挑选">
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="留空 = 放行全部"
            value={config.modelWhitelist}
            options={(status?.models ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.id})` }))}
            onChange={(v) => void patch({ modelWhitelist: v })}
          />
        </Form.Item>

        <Form.Item label="本地转发代理端口">
          <InputNumber
            min={1}
            max={65535}
            value={config.forward.port}
            onChange={(v) => v != null && setConfig({ ...config, forward: { ...config.forward, port: v } })}
            onBlur={() => void patch({ forward: { ...config.forward } })}
          />
        </Form.Item>
      </Form>

      <Card type="inner" size="small" title="转发代理状态" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text>
            状态：
            <Tag color={!config.enabled ? 'default' : running ? 'success' : 'error'}>
              {!config.enabled ? '未启用' : running ? '运行中' : '未运行'}
            </Tag>
          </Text>
          <Text copyable={{ text: baseUrl }}>转发 baseUrl：{baseUrl}</Text>
          <Text copyable={status?.key ? { text: status.key } : undefined}>
            访问密钥：{status?.key ? <Text code>{status.key}</Text> : <Text type="secondary">（尚未生成）</Text>}
          </Text>
          <Text>
            出口地址：
            {status?.egress ? `${status.egress.ip}${status.egress.country ? ` (${status.egress.country})` : ''}` : '未知'}
          </Text>
          <Text>可用模型数：{models.length}</Text>
          {status?.error && <Text type="danger">错误：{status.error}</Text>}
        </Space>
      </Card>

      <Space wrap>
        <Button onClick={refreshCatalog} loading={busy}>刷新模型目录</Button>
        <Button onClick={probe} loading={busy}>探测可用性</Button>
        <Tooltip title="轮换转发代理密钥（下游工具需同步更新）">
          <Button onClick={regenerateKey} loading={busy}>重新生成密钥</Button>
        </Tooltip>
        <Button onClick={refresh} loading={loading}>刷新状态</Button>
      </Space>
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <Card
      title="Zen 公开免费模型本地代理配置"
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Space size={4}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: dotColor,
              marginRight: 6,
            }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {!config.enabled ? '未启用' : running ? `运行中 · ${status?.port ?? config.forward.port}` : '已启用但未运行'}
          </Text>
        </Space>
      }
    >
      {body}
    </Card>
  );
};

export default ZenFreeProviderConfig;
