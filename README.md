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