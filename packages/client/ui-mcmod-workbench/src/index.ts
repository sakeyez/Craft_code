/** Serve the locally installed Monaco assets, isolated from the application's module loader. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'ui-mcmod-workbench'
export const inject: string[] = []

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (host) => {
    const root = join(dirname(fileURLToPath(import.meta.resolve('monaco-editor/package.json'))), 'min')
    host.effect(
      () =>
        host.webServer.register({
          kind: 'prefix',
          path: '/mc-editor',
          handler: async (req, res) => {
            if (req.method !== 'GET') {
              res.writeHead(405)
              res.end()
              return
            }
            const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).slice(
              '/mc-editor/'.length,
            )
            if (path === 'frame.html') {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(editorFrame)
              return
            }
            const file = join(root, path)
            const rel = relative(root, file)
            if (rel.startsWith('..') || !path.startsWith('vs/')) {
              res.writeHead(404)
              res.end()
              return
            }
            try {
              const bytes = await readFile(file)
              res.writeHead(200, {
                'content-type':
                  extname(file) === '.css'
                    ? 'text/css'
                    : extname(file) === '.ttf'
                      ? 'font/ttf'
                      : 'text/javascript',
                'cache-control': 'public, max-age=86400',
              })
              res.end(bytes)
            } catch {
              res.writeHead(404)
              res.end()
            }
          },
        }),
      'ui-mcmod-workbench: local editor assets',
    )
  })
}

const editorFrame = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#editor{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="editor"></div><script src="/mc-editor/vs/loader.js"></script><script>
require.config({paths:{vs:'/mc-editor/vs'}});
require(['vs/editor/editor.main'],function(){
  let editor, model, original, key, revision, mute=false, mode;
  const send=(type,data={})=>parent.postMessage({type,...data},location.origin);
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='document')return;
    const data=event.data; if(typeof data.text!=='string'||typeof data.key!=='string')return;
    const nextMode=typeof data.original==='string'?'diff':'edit';
    if(!editor||key!==data.key||mode!==nextMode){
      editor?.dispose();model?.dispose();original?.dispose();key=data.key;revision=data.revision;mode=nextMode;
      model=monaco.editor.createModel(data.text,data.language||'plaintext');
      const options={automaticLayout:true,minimap:{enabled:false},fontSize:14,readOnly:!!data.readonly,scrollBeyondLastLine:false,theme:data.dark?'vs-dark':'vs'};
      if(mode==='diff'){original=monaco.editor.createModel(data.original,data.language||'plaintext');editor=monaco.editor.createDiffEditor(document.getElementById('editor'),options);editor.setModel({original,modified:model});}
      else{editor=monaco.editor.create(document.getElementById('editor'),{...options,model});}
      const active=mode==='diff'?editor.getModifiedEditor():editor;
      model.onDidChangeContent(()=>{if(!mute)send('change',{key,text:model.getValue()});});
      active.onDidChangeCursorSelection(()=>{const r=active.getSelection();send('selection',{key,text:model.getValueInRange(r),start:r.startLineNumber,end:r.endLineNumber});});
      active.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>send('save',{key}));
      if(data.line)active.revealLineInCenter(data.line);
    }else {
      if(revision!==data.revision && model.getValue()!==data.text){mute=true;model.setValue(data.text);mute=false;}
      revision=data.revision;
      if(original && typeof data.original==='string' && original.getValue()!==data.original)original.setValue(data.original);
    }
  });send('ready');
});</script></body></html>`
