export type MindroomCommandItem = {
  name: string;
  syntax: string;
  description: string;
};

// Mirrors the MindRoom bot command set (mindroom/commands/parsing.py CommandType
// + _COMMAND_DOCS), in the order `!help` lists them.
export const MINDROOM_COMMANDS: MindroomCommandItem[] = [
  {
    name: 'help',
    syntax: '!help [topic]',
    description: 'Get help about available capabilities or a specific topic.',
  },
  {
    name: 'reload-plugins',
    syntax: '!reload-plugins',
    description: 'Reload configured plugins (admin only).',
  },
  {
    name: 'schedule',
    syntax: '!schedule <task>',
    description: 'Schedule a task for later execution.',
  },
  {
    name: 'list_schedules',
    syntax: '!list_schedules',
    description: 'List all scheduled tasks.',
  },
  {
    name: 'cancel_schedule',
    syntax: '!cancel_schedule <id|all>',
    description: 'Cancel one schedule by id or all schedules.',
  },
  {
    name: 'edit_schedule',
    syntax: '!edit_schedule <id> <task>',
    description: 'Update an existing schedule task.',
  },
  {
    name: 'jobs',
    syntax: '!jobs',
    description: 'List the background jobs running here.',
  },
  {
    name: 'cancel_job',
    syntax: '!cancel_job <id|all>',
    description: 'Cancel one background job by id or all of them here.',
  },
  {
    name: 'config',
    syntax: '!config <operation>',
    description: 'Manage MindRoom configuration (admin only).',
  },
  {
    name: 'desktop',
    syntax: '!desktop [setup|status|confirm|rotate|disconnect]',
    description: 'Manage your Desktop target.',
  },
  {
    name: 'mode',
    syntax: '!mode <agent> minimal|standard|show|reset',
    description: 'Switch one agent between standard tools and a Bash-only interface.',
  },
  {
    name: 'model',
    syntax: '!model [name|list|reset]',
    description: 'Show or switch the model used in the current thread.',
  },
  {
    name: 'room_model',
    syntax: '!room_model [name|list|reset]',
    description: 'Show the room model default or switch it (set/reset require a room admin).',
  },
  {
    name: 'thread_mode',
    syntax: '!thread_mode [room|thread|reset|show]',
    description: 'Show or switch the thread mode used in the current room (room admin only).',
  },
  {
    name: 'auto_approve',
    syntax: '!auto_approve [<minutes>|<hours>h|off]',
    description:
      'Run your tool calls in this thread without approval for a while, or show or end that window.',
  },
  {
    name: 'encrypt',
    syntax: '!encrypt [confirm]',
    description: 'Review or enable end-to-end encryption for the current room.',
  },
  {
    name: 'e2ee',
    syntax: '!e2ee',
    description: 'Show encryption diagnostics for the current room.',
  },
  {
    name: 'hi',
    syntax: '!hi',
    description: 'Show welcome information.',
  },
];
