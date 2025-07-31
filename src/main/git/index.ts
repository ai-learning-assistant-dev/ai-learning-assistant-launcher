import path from 'path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';

export async function gitClone(httpUrl: string, dir: string, branch?: string) {
  return git.clone({
    fs,
    http,
    dir,
    url: httpUrl,
    ref: branch, // 指定要克隆的分支
    singleBranch: !!branch, // 如果指定了分支，就只克隆那个分支
    depth: 1, // 浅克隆，加快速度
  });
}