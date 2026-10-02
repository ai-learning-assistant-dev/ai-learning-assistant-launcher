import React, { useState, useEffect, useCallback } from 'react';
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
  List,
} from 'antd';
import type {
  FreeProviderConfig,
  FreeProviderStatus,
} from '../../../main/llm-free/type-info';

const { Text } = Typography;

/** 探测状态 → 中文标签 + 颜色（键名必须与引擎 probe.js 的 STATE 取值完全一致：
 *  'available' / 'region-blocked' / 'unavailable' / 'throttled' / 'unknown'） */
const STATE_META: Record<string, { label: string; color: string }> = {
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
  { value: 'deep', label: 'Deep（深度推理）' },
];

const FINGERPRINT_OPTIONS = [
  { value: 'auto', label: 'Auto（完整四人组 + 兜底）' },
  { value: 'minimal', label: 'Minimal（仅填已声明名）' },
];

/**
 * 免密免费模型（Zen free lane）配置面板。
 *
 * 启动器只管理配置并提供一个本地 OpenAI 兼容转发代理；真正的模型调用发生在别处
 * （dsh / Obsidian / LM Studio / 下游工具）。本面板不承载原 DSH 插件的看板 / 公告 /
 * 自更新 / 热重载——那些运维功能已被砍掉，仅保留「状态点 + 转发密钥」这类最小可见信息。
 */
const ZenFreeProviderConfig: React.FC = () => {
  const [config, setConfig] = useState<FreeProviderConfig | null>(null);
  const [status, setStatus] = useState<FreeProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

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
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await window.mainHandle.llmFreeStart();
      message.success('免密免费模型转发代理已启动');
      await refresh();
    } catch (e) {
      message.error(`启动失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await window.mainHandle.llmFreeStop();
      message.success('免密免费模型转发代理已停止');
      await refresh();
    } catch (e) {
      message.error(`停止失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

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

  if (!config) {
    return (
      <Card title="免密免费模型（Zen free lane）" size="small" loading={loading} style={{ marginBottom: 16 }}>
        <div />
      </Card>
    );
  }

  const running = status?.running === true;
  const dotColor = !config.enabled ? '#8c8c8c' : running ? '#52c41a' : '#f5222d';
  const baseUrl = `http://${config.forward.host}:${status?.port || config.forward.port}/v1`;
  const models = status?.models ?? [];

  return (
    <Card
      title="免密免费模型（Zen free lane）"
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
      <Form layout="vertical" size="small">
        <Form.Item label="启用免密免费模型（拉起本地转发代理）">
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

      <Card
        type="inner"
        size="small"
        title={`可用模型列表（${models.length}）`}
        style={{ marginBottom: 12 }}
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            状态由「探测可用性」刷新
          </Text>
        }
      >
        {models.length === 0 ? (
          <Text type="secondary">
            暂无模型：请点击下方「刷新模型目录」从 Zen 网关拉取（需网络可达）。
          </Text>
        ) : (
          <List
            size="small"
            dataSource={models}
            style={{ maxHeight: 320, overflow: 'auto' }}
            renderItem={(m) => {
              const meta = STATE_META[m.state] ?? STATE_META.unknown;
              return (
                <List.Item
                  actions={[
                    <Tag key="state" color={meta.color}>{meta.label}</Tag>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span>
                        {m.name}
                        <Text type="secondary" code style={{ marginLeft: 8, fontSize: 12 }}>
                          {m.id}
                        </Text>
                      </span>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        上下文 {(m.contextWindow / 1024).toFixed(0)}K · 输出上限 {(m.maxOutput / 1024).toFixed(0)}K
                        {m.vision ? ' · 视觉' : ''}
                        {m.reasoning ? ' · 推理' : ''}
                      </Text>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      <Space wrap>
        {running ? (
          <Button onClick={stop} loading={busy}>停止</Button>
        ) : (
          <Button type="primary" onClick={start} loading={busy}>启动</Button>
        )}
        <Button onClick={refreshCatalog} loading={busy}>刷新模型目录</Button>
        <Button onClick={probe} loading={busy}>探测可用性</Button>
        <Tooltip title="轮换转发代理密钥（下游工具需同步更新）">
          <Button onClick={regenerateKey} loading={busy}>重新生成密钥</Button>
        </Tooltip>
        <Button onClick={refresh} loading={loading}>刷新状态</Button>
      </Space>
    </Card>
  );
};

export default ZenFreeProviderConfig;
