## AI相关容器的配置文件

## install_wsl.msi
AI相关程序依赖容器运行，为了能给用户自动安装wsl，在测试和发布包时需要把安装包放到此目录，相对项目根目录路径为 ```./ai-assistant-backend/insall_wsl.msi```，但是为了避免git太大，不要把安装包上传到git

## install_podman.exe
AI相关程序依赖容器运行，为了能给用户自动安装podman，在测试和发布包时需要把安装包放到此目录，相对项目根目录路径为 ```./ai-assistant-backend/insall_podman.exe```，但是为了避免git太大，不要把安装包上传到git

podman安装程序是从 https://github.com/containers/podman/releases 这里下载的名为 podman-5.5.1-setup.exe 的安装程序

## podman_machine.tar.zst
podman WSL虚拟机的镜像，相对路径名为 ```./ai-assistant-backend/podman_machine.tar.zst```

## nvidia-container-toolkit_x86_64.tar.gz
podman WSL虚拟机的Nvidia显卡工具，让容器内程序能调用Nvidia显卡加速，相对路径名为 ```./ai-assistant-backend/nvidia-container-toolkit_x86_64.tar.gz```

目前从 https://github.com/containers/podman-machine-wsl-os/releases 下载的名为 5.3-rootfs-amd64.tar.zst
 的文件，但是这个仓库刚刚过时，未来可能需要从 https://github.com/containers/podman-machine-os/releases 下载

## install_obsidian.exe
用户需要UI程序来使用AI工具，我们选用的是 obsidian ， 为了能给用户自动安装 obsidian ，在测试和发布包时需要把安装包放到此目录，相对项目根目录的路径为 ```./ai-assistant-backend/install_obsidian.exe```，但是为了避免git太大，不要把安装包上传到git

## install_lm_studio.exe
AI大模型的支撑程序，可以在LM Studio官网下载到，相对项目根目录的路径为 ```./ai-assistant-backend/install_lm_studio.exe```，但是为了避免git太大，不要把安装包上传到git

## container-config.json
存储各个服务的容器参数

## index-tts
TTS服务所需的音色配置文件，被挂载到容器内部

## kokoro
TTS服务所需的音色配置文件，被挂载到容器内部