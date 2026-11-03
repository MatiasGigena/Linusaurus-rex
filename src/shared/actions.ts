import type { ActionDefinition } from './types.js';

// Linux equivalents of the published client actions. Platform-only actions are excluded.
export const CLIENT_ACTIONS: ActionDefinition[] = [
  {
    "name": "client.window.new",
    "title": "New Window",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.window.close",
    "title": "Close Window",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.window.fullscreen.toggle",
    "title": "Toggle Full Screen",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.close",
    "title": "Close",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.palette.toggle",
    "title": "Command Palette…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.settings",
    "title": "Settings…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.diagnostics",
    "title": "Rex Diagnostics",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.onboarding",
    "title": "Open Onboarding Session…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.visibility.toggle",
    "title": "Toggle Visibility",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.version.copy",
    "title": "Copy Version Info",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.debug.copy",
    "title": "Copy Debug Info",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.notice.dismiss",
    "title": "Dismiss Notice",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.shortcuts.edit",
    "title": "Change Shortcut…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.agents.setup",
    "title": "Install Rex for Agents Installs the Rex skill and hooks for Claude Code, Codex, and other agents.",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.new",
    "title": "New Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.switch",
    "title": "Change Session…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.select",
    "title": "Go to Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.next",
    "title": "Next Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.previous",
    "title": "Previous Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.rename",
    "title": "Rename Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.close",
    "title": "Close Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.refresh",
    "title": "Refresh Sessions",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.open_on_web",
    "title": "Open Session on Web…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.collapse",
    "title": "Collapse Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.expand",
    "title": "Expand Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "session.collapse_others",
    "title": "Collapse Other Sessions",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.host.switch",
    "title": "Switch Host",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.host.add",
    "title": "Add Remote Host…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.host.remove",
    "title": "Remove Host…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.new",
    "title": "New Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.close",
    "title": "Close Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.rename",
    "title": "Rename Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.next",
    "title": "Show Next Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.previous",
    "title": "Show Previous Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.goto",
    "title": "Go to Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.move",
    "title": "Move Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.move.backward",
    "title": "Move Tab Backward",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.move.forward",
    "title": "Move Tab Forward",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab.move_to_new_window",
    "title": "Move Tab to New Window",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split",
    "title": "Split Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split.left",
    "title": "Split Pane Left",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split.right",
    "title": "Split Pane Right",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split.up",
    "title": "Split Pane Up",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split.down",
    "title": "Split Pane Down",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.split.auto",
    "title": "Split Pane Best Fit",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus",
    "title": "Focus Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus.left",
    "title": "Focus Pane Left",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus.right",
    "title": "Focus Pane Right",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus.up",
    "title": "Focus Pane Up",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus.down",
    "title": "Focus Pane Down",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus_next",
    "title": "Focus Next Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.focus_previous",
    "title": "Focus Previous Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move",
    "title": "Move Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move.left",
    "title": "Move Pane Left",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move.right",
    "title": "Move Pane Right",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move.up",
    "title": "Move Pane Up",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move.down",
    "title": "Move Pane Down",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.float",
    "title": "Float Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.minimize_floating",
    "title": "Minimize Floating Window",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.minimize_all_floating",
    "title": "Minimize Floating Windows",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.zoom",
    "title": "Zoom Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.close",
    "title": "Close Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.balance",
    "title": "Balance Splits",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.resize",
    "title": "Resize Pane",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move_to_new_tab",
    "title": "Move Pane to New Tab",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.move_to_tab",
    "title": "Move Pane to Tab…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.go_to_directory",
    "title": "Go to Directory…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.insert_path",
    "title": "Insert Path…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.copy_id",
    "title": "Copy Pane ID",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "pane.send_key",
    "title": "Send Key",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.key.forward",
    "title": "Send Key to Server",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.prompt.previous",
    "title": "Jump to Previous Prompt",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.prompt.next",
    "title": "Jump to Next Prompt",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.mode.enter",
    "title": "Enter Mode",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.mode.exit",
    "title": "Exit Mode",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.mode.exit_all",
    "title": "Exit All Modes",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.find.open",
    "title": "Find…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.find.next",
    "title": "Find Next",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.find.previous",
    "title": "Find Previous",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.font.increase",
    "title": "Increase Font Size",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.font.decrease",
    "title": "Decrease Font Size",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.font.reset",
    "title": "Reset Font Size",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.sidebar.toggle",
    "title": "Toggle Sidebar",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.sidebar.activity.toggle",
    "title": "Toggle Activity",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.sidebar.activity.by_session",
    "title": "Show Activity by Session",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.sidebar.activity.by_priority",
    "title": "Show Activity by Priority",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.sidebar.filter.focus",
    "title": "Focus Tab Filter",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.tab_style.toggle",
    "title": "Toggle Tab Style",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.theme.change",
    "title": "Change Theme…",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.theme.import",
    "title": "Import Theme File",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.appearance.switch_mode",
    "title": "Switch Appearance Mode",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.config.copy_path",
    "title": "Copy Config File Path",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  },
  {
    "name": "client.config.reload",
    "title": "Reload Config",
    "kind": "client",
    "args": {
      "type": "object",
      "additionalProperties": true
    }
  }
];

export const SHORTCUT_ACTIONS: Record<string,string> = {
  'command-palette':'client.palette.toggle','session-switcher':'session.switch','new-session':'session.new','new-window':'client.tab.new','close-window':'client.tab.close','toggle-sidebar':'client.sidebar.toggle','split-right':'pane.split.right','split-below':'pane.split.down','zoom':'pane.zoom','settings':'client.settings','find':'client.find.open',
  copy:'client.copy',paste:'client.paste','font-increase':'client.font.increase','font-decrease':'client.font.decrease','font-reset':'client.font.reset',
  'next-tab':'client.tab.next','previous-tab':'client.tab.previous','focus-left':'pane.focus.left','focus-right':'pane.focus.right','focus-up':'pane.focus.up','focus-down':'pane.focus.down',
};
CLIENT_ACTIONS.push({name:'client.copy',title:'Copy',kind:'client'},{name:'client.paste',title:'Paste',kind:'client'});
CLIENT_ACTIONS.push({name:'client.pair_device',title:'Pair Device with QR Code…',kind:'client'});

export function serverShortcut(shortcut:string):string {
  const aliases:Record<string,string>={control:'ctrl',command:'super',cmd:'super',meta:'super',cmdorctrl:'ctrl',option:'alt',comma:',',period:'.',equal:'=',minus:'-',plus:'+',slash:'/',backslash:'\\',semicolon:';',quote:"'",backquote:'`',bracketleft:'[',bracketright:']',arrowup:'up',arrowdown:'down',arrowleft:'left',arrowright:'right'};
  return shortcut.replace(/\s/g,'').split('>').map(chord=>chord.split('+').map(token=>token.startsWith('[')&&token.endsWith(']')?token:aliases[token.toLowerCase()]??token.toLowerCase()).join('+')).join('>');
}
