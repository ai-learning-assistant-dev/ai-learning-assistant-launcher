import { Button, notification } from "antd";
import { useExampleContainer } from "../../containers/example-container";
import { NavLink } from "react-router-dom";
import { ServiceName } from "../../../main/example-main/type-info";
import { useCallback, useState } from "react";

export default function ExamplePage(){
  const {exampleDatas, loading, action} = useExampleContainer('vault222');
  const [handleLoading, setHandleLoading] = useState(false);
  const [handleResult, setHandleResult] = useState(null);
  const installExample = useCallback(async (service: ServiceName)=>{
    notification.success({
      message: `函数式调用开始安装${service}`,
      placement: 'topRight',
    });
    setHandleLoading(true)
    const result = await window.mainHandle.installExampleHandle('service1')
    if(result){
      setHandleResult(result);
      notification.success({
        message: `函数式调用安装${service}成功`,
        placement: 'topRight',
      });
    }else{
      notification.error({
        message: `函数式调用安装${service}失败`,
        placement: 'topRight',
      });
    }
    setHandleLoading(false)
  },[setHandleLoading, setHandleResult])
  return (
    <div className="example-page">
      <NavLink to="/hello"><Button>返回</Button></NavLink>
      <Button loading={loading} onClick={()=>action('install', 'service1')}>消息式调用main线程</Button>
      <Button loading={handleLoading} onClick={async ()=> installExample('service1')}>函数式调用main线程</Button>
      <div className="list">
        {exampleDatas?.map(item=>(<div>{JSON.stringify(item)}</div>))}
      </div>
      handleResult:{JSON.stringify(handleResult)}
    </div>
  )
}