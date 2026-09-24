import { useEffect, useRef } from 'react';
import { ITerminalInitOnlyOptions, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Tomorrow } from 'xterm-theme';
import '@xterm/xterm/css/xterm.css';
import { channel } from '../../../main/terminal-log/type-info';
import {
  AllService,
  MESSAGE_TYPE,
  MessageData,
} from '../../../main/ipc-data-type';

/** 剩余空间不足时也保留的最小可用高度（px），调用方可用 style 覆盖 */
const DEFAULT_MIN_HEIGHT = 120;

/**
 * 终端容器的基础样式（调用方传入的 style 会覆盖这里的任意一项）：
 * - width/height 100%：兼容普通的块级父容器，flex 父容器里最终尺寸由 flex 决定
 * - minWidth/minHeight：允许被压缩，但保留一个可用的下限
 * - overflow: hidden：终端内容不参与父容器的尺寸计算，避免把父容器撑大
 * - 不设 padding/border：FitAddon 按容器的像素尺寸换算行列数，任何内边距都会算进终端区域
 */
const DEFAULT_CONTAINER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: DEFAULT_MIN_HEIGHT,
  overflow: 'hidden',
  boxSizing: 'border-box',
};

/**
 * 命令行日志，让用户可以查看当前耗时任务的运行进度。
 * 尺寸不需要调用方指定：容器会占满父容器的剩余空间，再由 FitAddon 换算出行列数，
 * props.cols / props.rows 只作为首帧的初始值。
 */
export function TerminalLogScreen(
  props: {
    id: string;
    style?: React.CSSProperties;
    className?: string;
  } & ITerminalInitOnlyOptions,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 调用方通过 style 指定了高度（例如被缩放的固定布局）就保持它原本的大小；
  // 否则用 flex-basis: 0 + grow 占满父容器的剩余空间：不参与“谁更高”的竞争，
  // 只吃剩下的空间，不会把兄弟元素挤小（用 height: 100% 反而会跟兄弟抢高度）
  const hasFixedHeight =
    props.style?.height !== undefined || props.style?.maxHeight !== undefined;
  const containerStyle: React.CSSProperties = {
    ...DEFAULT_CONTAINER_STYLE,
    flex: hasFixedHeight ? '0 1 auto' : '1 1 0%',
    ...props.style,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      disableStdin: true,
      cols: props.cols,
      rows: props.rows,
      theme: Tomorrow,
      fontSize: 12,
      convertEol: true,
    });
    // 官方 FitAddon：把容器的像素尺寸换算成终端的行列数
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    let disposed = false;
    let frame = 0;
    let renderSub: { dispose: () => void } | undefined;

    /** 让终端铺满容器；行列数没变时什么都不做，避免 ResizeObserver 抖动 */
    const fit = () => {
      if (disposed) {
        return;
      }
      const dimensions = fitAddon.proposeDimensions();
      // 字符尺寸还没量出来（首帧）、容器被隐藏时，行列数会是 undefined / NaN
      if (
        !dimensions ||
        !Number.isFinite(dimensions.cols) ||
        !Number.isFinite(dimensions.rows)
      ) {
        return;
      }
      if (dimensions.cols === term.cols && dimensions.rows === term.rows) {
        return;
      }

      // 用户本来停在底部时，缩放后继续跟随最新日志
      const buffer = term.buffer.active;
      const following = buffer.viewportY >= buffer.baseY;
      fitAddon.fit();
      if (following) {
        term.scrollToBottom();
      }
    };

    /** 同一帧内的多次触发只适配一次 */
    const scheduleFit = () => {
      if (disposed || frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };

    // 父容器伸缩、窗口缩放、布局变化都会触发尺寸变化
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);

    // 首帧字符尺寸可能还没量出来，这里先适配一次，稍后再校准
    scheduleFit();
    const settleTimer = window.setTimeout(scheduleFit, 100);
    // 第一次渲染完成后字符尺寸一定已就绪，此时再精确适配一次
    renderSub = term.onRender(() => {
      renderSub?.dispose();
      renderSub = undefined;
      scheduleFit();
    });

    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (
        messageType: MESSAGE_TYPE.DATA,
        messageData: MessageData<'query', AllService, string>,
      ) => {
        if (disposed) {
          return;
        }
        term.write(messageData.data);
      },
    );

    return () => {
      disposed = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.clearTimeout(settleTimer);
      renderSub?.dispose();
      resizeObserver.disconnect();
      cancel?.();
      // dispose 会一并释放已加载的 addon
      term.dispose();
    };
  }, [props.id, props.cols, props.rows]);

  return (
    <div
      id={props.id}
      ref={containerRef}
      className={props.className}
      style={containerStyle}
    />
  );
}
