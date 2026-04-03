import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';

function onAuth(){
  return {
    username: 'aladeploy',
    password: 'b4d6791010b8e5c953233390c8551fda',
  }
}

export async function gitClone(httpUrl: string, dir: string, branch?: string) {
  return git.clone({
    fs,
    http,
    dir,
    url: httpUrl,
    ref: branch, // 指定要克隆的分支
    singleBranch: !!branch, // 如果指定了分支，就只克隆那个分支
    depth: 1, // 浅克隆，加快速度
    onAuth: onAuth,
  });
}

export async function getRemoteInfo(httpUrl: string){
  return git.getRemoteInfo({
    http,
    url: httpUrl,
    onAuth,
  });
}