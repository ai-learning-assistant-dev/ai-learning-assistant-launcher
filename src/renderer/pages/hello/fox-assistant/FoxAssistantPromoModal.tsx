import { Button, Modal, Steps, Tabs } from 'antd';
import './index.scss';
import { FoxIcon } from './FoxAssistantPromoSlide';
import {
  FOX_ASSISTANT_FEATURES,
  FOX_ASSISTANT_INSTALL_GUIDES,
  FOX_ASSISTANT_NAME,
  FOX_ASSISTANT_NOTICES,
  FOX_ASSISTANT_PRIVACY_URL,
  FOX_ASSISTANT_REPO_URL,
  FOX_ASSISTANT_SETUP_STEPS,
  FOX_ASSISTANT_STORE_URL,
  FOX_ASSISTANT_SUB_SLOGAN,
  FOX_ASSISTANT_ZIP_URL,
} from './constants';

function openUrl(url: string) {
  window.electron?.ipcRenderer.sendMessage(
    'open-external-url',
    'open',
    'browser',
    url,
  );
}

export default function FoxAssistantPromoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      className="fox-modal"
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={720}
    >
      <div className="fox-modal__body">
        <div className="fox-modal__header">
          <FoxIcon size={40} />
          <div>
            <h3 className="fox-modal__title">{FOX_ASSISTANT_NAME}</h3>
            <p className="fox-modal__subtitle">{FOX_ASSISTANT_SUB_SLOGAN}</p>
          </div>
        </div>

        <div className="fox-modal__features">
          {FOX_ASSISTANT_FEATURES.map((item) => (
            <div key={item.key} className="fox-modal__feature">
              <span className="fox-modal__feature-title">{item.title}</span>
              <span className="fox-modal__feature-desc">{item.desc}</span>
            </div>
          ))}
        </div>

        <div className="fox-modal__section">
          <div className="fox-modal__section-title">下载</div>
          <div className="fox-modal__actions">
            <Button
              type="primary"
              onClick={() => openUrl(FOX_ASSISTANT_STORE_URL)}
            >
              商店一键安装（Chrome / Edge）
            </Button>
            <Button onClick={() => openUrl(FOX_ASSISTANT_ZIP_URL)}>
              下载源码 ZIP
            </Button>
            <Button type="link" onClick={() => openUrl(FOX_ASSISTANT_REPO_URL)}>
              开源仓库
            </Button>
            <Button
              type="link"
              onClick={() => openUrl(FOX_ASSISTANT_PRIVACY_URL)}
            >
              隐私政策
            </Button>
          </div>
          <p className="fox-modal__hint">
            装了商店版就不用下载 ZIP；ZIP 用于手动加载或 Firefox。
          </p>
        </div>

        <div className="fox-modal__section">
          <div className="fox-modal__section-title">安装（手动加载）</div>
          <Tabs
            size="small"
            items={FOX_ASSISTANT_INSTALL_GUIDES.map((guide) => ({
              key: guide.key,
              label: guide.label,
              children: (
                <>
                  <Steps
                    direction="vertical"
                    size="small"
                    current={-1}
                    items={guide.steps.map((step) => ({ title: step }))}
                  />
                  {'extra' in guide && guide.extra ? (
                    <p className="fox-modal__hint">{guide.extra}</p>
                  ) : null}
                </>
              ),
            }))}
          />
        </div>

        <div className="fox-modal__section">
          <div className="fox-modal__section-title">装好后三步开用</div>
          <Steps
            direction="vertical"
            size="small"
            current={-1}
            items={FOX_ASSISTANT_SETUP_STEPS.map((step) => ({ title: step }))}
          />
        </div>

        <ul className="fox-modal__notices">
          {FOX_ASSISTANT_NOTICES.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
