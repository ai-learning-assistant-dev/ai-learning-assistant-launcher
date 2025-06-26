import { useCallback } from "react";
import { Button, List } from "antd";
import { Link, NavLink } from "react-router-dom";
import "./index.scss";
import { channel } from "../../../main/cmd/type-info";
import useCmd from "../../containers/use-cmd";
import useConfigs from "../../containers/use-configs";


export default function ObsidianApp() {
  const { action: cmdAction, loading: cmdLoading } = useCmd();
  const { obsidianConfig, action: configsAction, loading: configsLoading } = useConfigs();

  const startObsidian = useCallback(()=>{
    cmdAction('start','obsidianApp')
  },[cmdAction])

  const locationObsidian = useCallback(()=>{
    configsAction('update','obsidianApp')
  },[])
  return (
    <div className="obsidian-app">
      <List
        className="ai-service-list"
        header={
          <div className="header-container">
            <Button><NavLink to="/hello">返回</NavLink></Button>
          </div>
        }
        bordered
      >
        <List.Item>
          
        </List.Item>
        <List.Item>
          <Button><NavLink to="obsidian-plugin">插件管理</NavLink></Button>
        </List.Item>
        <List.Item actions={[<Button onClick={locationObsidian}>定位阅读器</Button>,<Button onClick={startObsidian}>运行阅读器</Button>]}>
          {obsidianConfig?.obsidianApp?.bin}
        </List.Item>
      </List>
    </div>
  );
}