import { Modal } from 'antd';
import { useState, useEffect } from 'react';
import './WelcomeModal.css';
import jointBuildIcon from '../../../../icons/joint_build.png';

const STORAGE_KEY = 'ai_learning_assistant_welcome_shown';

export default function WelcomeModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 检查是否已经显示过欢迎弹窗
    const hasShown = localStorage.getItem(STORAGE_KEY);
    if (!hasShown) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  };

  const handleReject = () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    setVisible(false);
  };

  return (
    <Modal
      open={visible}
      closable={false}
      footer={null}
      width={520}
      centered
      maskClosable={false}
    >
      <div className="welcome-modal-content">
        <h2 className="welcome-modal-title">
          <img src={jointBuildIcon} alt="共建" className="welcome-title-icon" /> 加入"AI学习助手-共建计划"，为知识共享添把柴
        </h2>
        <p className="welcome-modal-description">
          通过闲时分享少量带宽，不仅能加速您的下载，也能帮助其他学习者更快获取大模型与课程资源。
        </p>
        <div className="welcome-modal-note">
          (推荐开启，后续随时可关闭)
        </div>
        <div className="welcome-modal-buttons">
          <button className="btn-reject" onClick={handleReject}>
            残忍拒绝
          </button>
          <button className="btn-accept" onClick={handleAccept}>
            我愿意加入共建计划
          </button>
        </div>
      </div>
    </Modal>
  );
}
