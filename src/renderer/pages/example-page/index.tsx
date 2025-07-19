import { Button } from "antd";
import { useExampleContainer } from "../../containers/example-container";
import { NavLink } from "react-router-dom";

export default function ExamplePage(){
  const {exampleDatas, loading, action} = useExampleContainer('vault222');
  return (
    <div className="example-page">
      <NavLink to="/hello"><Button>返回</Button></NavLink>
      <Button loading={loading} onClick={()=>action('install', 'service1')}>消息式调用main线程</Button>
      <Button onClick={()=>action('install', 'service1')}>函数式调用main线程</Button>
      <div className="list">
        {exampleDatas?.map(item=>(<div>{JSON.stringify(item)}</div>))}
      </div>
      loading:{loading.toString()}
    </div>
  )
}