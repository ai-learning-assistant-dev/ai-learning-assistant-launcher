## AI相关容器的配置文件

## install_wsl.msi
AI相关程序依赖容器运行，为了能给用户自动安装wsl，在测试和发布包时需要把安装包放到此目录，相对项目根目录路径为 ```./ai-assistant-backend/insall_wsl.msi```，但是为了避免git太大，不要把安装包上传到git

## install_podman.exe
AI相关程序依赖容器运行，为了能给用户自动安装podman，在测试和发布包时需要把安装包放到此目录，相对项目根目录路径为 ```./ai-assistant-backend/insall_podman.exe```，但是为了避免git太大，不要把安装包上传到git

podman安装程序是从 https://github.com/containers/podman/releases 这里下载的名为 podman-5.5.1-setup.exe 的安装程序

## podman_machine.tar.zst
podman WSL虚拟机的镜像，相对路径名为 ```./ai-assistant-backend/podman_machine.tar.zst```

目前从 https://github.com/containers/podman-machine-wsl-os/releases 下载的名为 5.3-rootfs-amd64.tar.zst
 的文件，但是这个仓库刚刚过时，未来可能需要从 https://github.com/containers/podman-machine-os/releases 下载

## install_obsidian.exe
用户需要UI程序来使用AI工具，我们选用的是 obsidian ， 为了能给用户自动安装 obsidian ，在测试和发布包时需要把安装包放到此目录，相对项目根目录的路径为 ```./ai-assistant-backend/install_obsidian.exe```，但是为了避免git太大，不要把安装包上传到git
