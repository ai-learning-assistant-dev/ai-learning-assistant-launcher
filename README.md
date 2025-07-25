# AI学习助手启动器
这个项目的作用是帮助用户更快的安装和使用AI学习助手。

因为AI模型本地部署比较复杂，所以我们把这些安装配置过程写成了自动化程序放在了这个AI学习助手启动器里，让所有人能没有门槛的完全在离线环境中使用AI学习助手。

## 开发本项目基本命令
```shell
#安装依赖
npm install
#启动
npm run start
#打包-不压缩包
npm run package
#打包-压缩包
npm run make
```

## 目录结构
```
external-resources 存放要被启动器管理的其他程序的资源的位置
|--ai-assistant-backend 虚拟机安装包，容器镜像，容器配置文件
|--config 启动器配置文件
|--obsidian-plugins-template obsidian插件代码
|--user-workspace obsidian用户数据
src 启动器源码
|--main 启动器跑在node部分的代码，作用和网站的后端相同，只是跑在客户的本机node中
   |--cmd 需要用命令行实现的业务代码
   |--configs 用于读取external-resources目录中的配置文件的代码
   |--exec 在用户机器上执行命令行的核心代码，最好不要动它
   |--podman-desktop podman虚拟机的接口代码，从podman-desktop复制过来的的
|--renderer 前端代码
   |--containers 业务逻辑组件
   |--pages 页面代码
forge.config.ts 打包器配置文件
```

## ！！！注意！！！
### Windows中首次安装AI工具箱需要管理员模式
开发者需要先在管理员模式的cmd中运行npm run start，分发的包需要用户在兼容性设置里设置为以管理员模式运行，因为sudo-prompt停止维护了，而wsl必须在管理员模式安装。

### 为了提升软件安装速度，podman的安装过程采用了离线安装包，所以目前只兼容Windows 10/11 X86_64的操作系统

## 安装本地AI服务的流程

|序号| 操作 | 时间 |
|-|------|-----|
|0|解压安装包 | 1分钟 |
|1|安装WSL系统组件 | 5分钟 |
|2|安装Podman程序 | 5分钟 |
|3|初始化Podman虚拟机 | 5分钟 |
|4|在Podman虚拟机内安装nvidia-container-toolkit | 1分钟 |
|5|导入镜像 | 5分钟 |
|6|创建容器 | 0.5分钟 |

### 用户操作的实际执行对应上表的过程
|操作|经过的操作|最终状态|
|----|---------|---|
|安装WSL| 1 |1 2 之间|
|安装第一个服务|2 3 4 5 6| 6 之后|
|安装第二个服务|6| 6 之后|
|删除服务| 6 | 5 6 之间|
|删除了所有服务| 6 5 | 4 5 之间|
|删除了所有服务和缓存|6 3| 2 3 之间|
|删除了所有服务和缓存之后安装一个服务| 3 4 5 6| 6 之后|