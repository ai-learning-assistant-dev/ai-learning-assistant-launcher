# AI学习助手启动器

AI模型本地部署比较复杂，所以把这些安装配置过程写成了自动化程序放在了这个启动器里，以降低门槛实现在离线环境中使用AI学习助手。

## 与开发相关的命令

```shell
# 安装依赖
npm install
# 启动
npm run start
# 打包-不压缩包
npm run package
# 打包-压缩包-包含依赖软件，最终包体积大小约为1.4GB
npm run make
# 打包-压缩包-不包含依赖软件，最终包体积大约100MB
npm run make-mini
```

## 项目结构

```
external-resources 存放要被启动器管理的其他程序的资源的位置
    |--ai-assistant-backend 虚拟机安装包，容器镜像，容器配置文件
    |--config 启动器配置文件
    |--obsidian-plugins-template obsidian插件代码
    |--user-workspace obsidian用户数据
tests 测试
	|-- READMD.md 单元测试和集成测试文档
src 启动器源码
    |--main 启动器跑在node部分的代码，作用和网站的后端相同，只是跑在客户的本机node中
       |--cmd 需要用命令行实现的业务代码
       |--configs 用于读取external-resources目录中的配置文件的代码
       |--exec 在用户机器上执行命令行的核心代码，最好不要动它
       |--git 提供git操作的工具代码
       |--lm-studio 操作LM Studio的代码
       |--logger 日志
       |--obsidian-plugin obsidian插件管理代码
       |--podman-desktop podman虚拟机的接口代码，从podman-desktop复制过来的的
       |--workspace 工作区操作代码
    |--renderer 前端代码
       |--containers 业务逻辑组件
       |--pages 页面代码
          |--ai-service 学习助手工具箱
          |--asr-config ASR设置页面
          |--example-page 示例代码
          |--lm-service LM Studio管理页
          |--obsidian-app Obsidian设置页面
          |--obsidian-plugin Obsidian插件设置页面
          |--tts-config TTS设置页面
          |--workspace-manage 工作区管理页面
forge.config.ts 打包器配置文件
```

# 帮助

1. 开发时，修改`main`代码后手动停止程序然再重启程序才能看到效果，修改`renderer`代码后不需要重启程序即可立即看到效果。

2. （Windows）首次安装AI工具箱需要管理员模式

开发者需要先在管理员模式的`cmd`中运行`npm run start`，分发的包需要用户在兼容性设置里设置为以管理员模式运行，因为`sudo-prompt`停止维护了，而`wsl`必须在管理员模式安装。
