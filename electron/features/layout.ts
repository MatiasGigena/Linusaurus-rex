import type { Host } from '../../src/shared/types.js';
type Caller = (host: Host, method: string, payload: Record<string, unknown>) => Promise<any>;
type Node = {block_id?:string;split?:{before:Node;after:Node;direction:string}};

export function validateBounds(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid floating pane bounds.');
  const [x, y, width, height] = value;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) throw new Error('Floating panes must fit inside the workspace.');
  return [x,y,width,height];
}

export async function layoutAction(call: Caller, host: Host, args: {sessionId:string;blockId:string;operation:string;targetWindowId?:string;layerId?:string}) {
  const {sessionId,blockId,operation} = args;
  const ref = {session_id:sessionId,block_id:blockId};
  if (operation === 'float') return call(host, 'session.float_block', {...ref,bounds:[.15,.15,.7,.7]});
  if (operation === 'minimize' || operation === 'restore') {
    if (!args.layerId) throw new Error('Choose a floating pane.');
    return call(host,'session.set_layer_state',{session_id:sessionId,layer_id:args.layerId,state:operation==='minimize'?'minimized':'normal',...(operation==='restore'?{focus:true}:{})});
  }
  if (operation === 'balance') {
    const view = await call(host,'session.view',{session_id:sessionId});
    const window = view.windows?.find((w:any)=>(w.layers??[]).some((l:any)=>(l.blocks??[]).some((b:any)=>b.block_id===blockId)));
    if (!window) throw new Error('The pane no longer exists.');
    const first = (node?:Node):string|undefined => node?.block_id || (node?.split && (first(node.split.before)||first(node.split.after)));
    const visit = async (node?:Node):Promise<void> => {
      if (!node?.split) return;
      const before = first(node.split.before), after = first(node.split.after);
      if (before && after) await call(host,'session.resize_pane',{session_id:sessionId,direction:node.split.direction,before_block_id:before,after_block_id:after,ratio:.5});
      await visit(node.split.before); await visit(node.split.after);
    };
    for (const layer of window.layers??[]) await visit(layer.layout);
    return;
  }
  let created: {window_id?:string;block_ids?:string[]} | undefined;
  try {
    let targetBlock: string | undefined;
    if (operation === 'moveToNewTab') {
      created = await call(host,'session.new_window',{session_id:sessionId,window_label:'Terminal',layout:{block:{flavor:'com.superlogical.terminal.shell'}},focus:false});
      targetBlock = created?.block_ids?.[0];
    } else if (operation === 'moveToTab') {
      const view = await call(host,'session.view',{session_id:sessionId});
      const window = view.windows?.find((w:any)=>w.window_id===args.targetWindowId);
      targetBlock = window?.focused_block_id;
    } else throw new Error('Unsupported layout operation.');
    if (!targetBlock || targetBlock === blockId) throw new Error('Choose another tab with a terminal.');
    await call(host,'session.move_block',{...ref,anchor_block_id:targetBlock,direction:'horizontal',side:'after'});
    if (created) await call(host,'block.close',{session_id:sessionId,block_id:targetBlock});
    await call(host,'session.focus_block',ref);
  } catch (error) {
    if (created?.window_id) {
      // Only the temporary placeholder is ours to clean up. A moved user pane must survive.
      const view = await call(host,'session.view',{session_id:sessionId}).catch(()=>null);
      const window = view?.windows?.find((w:any)=>w.window_id===created!.window_id);
      const blocks = window?.layers?.flatMap((layer:any)=>layer.blocks??[])??[];
      if (blocks.length === 1 && blocks[0].block_id === created.block_ids?.[0]) await call(host,'session.close_window',{session_id:sessionId,window_id:created.window_id}).catch(()=>{});
    }
    throw error;
  }
}
