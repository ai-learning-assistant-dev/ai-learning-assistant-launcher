import path from 'path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';

export async function gitClone(httpUrl: string, dir: string) {
  return git.clone({
    fs,
    http,
    dir,
    url: httpUrl,
    depth: 1,
  });
}
