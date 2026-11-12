import { KeyboardEvent } from 'react';
import foxLogo from './fox-logo.png';
import './index.scss';
import {
  FOX_ASSISTANT_BADGE,
  FOX_ASSISTANT_NAME,
  FOX_ASSISTANT_SLOGAN,
  FOX_ASSISTANT_SUB_SLOGAN,
  FOX_ASSISTANT_TAGS,
} from './constants';

/** 插件官方 Logo（来自 Chrome 应用商店页），替换原手绘示意图标 */
export function FoxIcon({ size = 32 }: { size?: number }) {
  return (
    <img
      className="fox-icon"
      src={foxLogo}
      width={size}
      height={size}
      alt={FOX_ASSISTANT_NAME}
    />
  );
}

/** 右侧界面示意：浏览器窗口 + 右侧 AI 侧边栏，纯 SVG 绘制 */
function BrowserMock() {
  return (
    <svg
      className="fox-promo__mock"
      viewBox="0 0 520 320"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        x="10"
        y="10"
        width="500"
        height="300"
        rx="12"
        fill="#26262B"
        stroke="#3A3A42"
        strokeWidth="1"
      />
      <path
        d="M22 10 L498 10 Q510 10 510 22 L510 46 L10 46 L10 22 Q10 10 22 10 Z"
        fill="#33333B"
      />
      <circle cx="30" cy="28" r="4" fill="#5A5A66" />
      <circle cx="45" cy="28" r="4" fill="#5A5A66" />
      <circle cx="60" cy="28" r="4" fill="#5A5A66" />
      <rect x="80" y="19" width="230" height="18" rx="9" fill="#1B1B1F" />
      <text
        x="92"
        y="32"
        fontSize="11"
        fill="#6E6E7A"
        fontFamily="system-ui, sans-serif"
      >
        example.com/article
      </text>

      <rect x="30" y="68" width="190" height="14" rx="4" fill="#56566380" />
      <rect x="30" y="96" width="300" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="114" width="286" height="8" rx="3" fill="#1D9E75" />
      <rect x="30" y="132" width="300" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="150" width="248" height="8" rx="3" fill="#1D9E75" />
      <rect x="30" y="168" width="300" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="186" width="212" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="216" width="150" height="12" rx="4" fill="#56566380" />
      <rect x="30" y="240" width="300" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="258" width="264" height="8" rx="3" fill="#4A4A55" />
      <rect x="30" y="276" width="290" height="8" rx="3" fill="#4A4A55" />

      <path
        d="M330 122 C352 122 352 150 372 150"
        fill="none"
        stroke="#1D9E75"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <path d="M366 145 L376 150 L366 156 Z" fill="#1D9E75" />

      <rect x="360" y="46" width="150" height="264" fill="#202025" />
      <path d="M360 46 L360 310" stroke="#2E2E38" strokeWidth="1" />
      <text
        x="378"
        y="72"
        fontSize="12"
        fill="#8A8A96"
        fontFamily="system-ui, sans-serif"
      >
        AI 对话
      </text>

      <rect
        x="372"
        y="86"
        width="126"
        height="30"
        rx="8"
        fill="#1D9E75"
        fillOpacity="0.16"
        stroke="#1D9E75"
        strokeWidth="1"
      />
      <rect x="382" y="95" width="82" height="5" rx="2.5" fill="#5DCAA5" />
      <rect x="382" y="105" width="56" height="5" rx="2.5" fill="#5DCAA5" />

      <rect
        x="372"
        y="128"
        width="126"
        height="84"
        rx="8"
        fill="#2A2A31"
        stroke="#3A3A42"
        strokeWidth="1"
      />
      <rect x="382" y="140" width="106" height="5" rx="2.5" fill="#1D9E75" />
      <rect x="382" y="152" width="92" height="5" rx="2.5" fill="#7A7A88" />
      <rect x="382" y="164" width="100" height="5" rx="2.5" fill="#7A7A88" />
      <rect x="382" y="176" width="74" height="5" rx="2.5" fill="#7A7A88" />
      <rect x="382" y="188" width="88" height="5" rx="2.5" fill="#1D9E75" />

      <rect
        x="372"
        y="252"
        width="126"
        height="34"
        rx="8"
        fill="#1B1B1F"
        stroke="#3A3A42"
        strokeWidth="1"
      />
      <rect x="384" y="265" width="64" height="6" rx="3" fill="#4A4A55" />
      <circle cx="484" cy="269" r="8" fill="#1D9E75" />
      <path d="M484 264 L490 269 L484 274 Z" fill="#101014" />
    </svg>
  );
}

export default function FoxAssistantPromoSlide({
  onClick,
}: {
  onClick: () => void;
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="fox-promo"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      title="点击查看下载地址与安装指引"
    >
      <div className="fox-promo__copy">
        <div className="fox-promo__brand">
          <FoxIcon size={34} />
          <span className="fox-promo__brand-name">{FOX_ASSISTANT_NAME}</span>
          <span className="fox-promo__brand-tag">浏览器插件</span>
        </div>

        <h2 className="fox-promo__title">{FOX_ASSISTANT_SLOGAN}</h2>
        <p className="fox-promo__subtitle">{FOX_ASSISTANT_SUB_SLOGAN}</p>

        <div className="fox-promo__tags">
          {FOX_ASSISTANT_TAGS.map((tag) => (
            <span key={tag} className="fox-promo__tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="fox-promo__footer">
          <span className="fox-promo__browsers">
            支持 Chrome · Edge · Firefox
          </span>
          <span className="fox-promo__cta">点击获取下载地址与安装指引</span>
        </div>
      </div>

      <div className="fox-promo__visual">
        <BrowserMock />
        <span className="fox-promo__badge">{FOX_ASSISTANT_BADGE}</span>
      </div>
    </div>
  );
}
