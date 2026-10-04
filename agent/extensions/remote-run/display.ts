// Display only: execution always uses the untouched argument vector.
export function commandLine(args: readonly string[]): string {
 return args.map(arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : /[\x00-\x1f\x7f]/.test(arg) ? JSON.stringify(arg) : "'"+arg.replaceAll("'", "'\\''")+"'").join(' ');
}
export function safeLine(text: string): string {
 return text.replace(/[\x00-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}`);
}
export function duration(ms: number): string {
 const seconds=Math.max(0,Math.floor(ms/1000));
 return seconds<60 ? `${seconds}s` : `${Math.floor(seconds/60)}m ${seconds%60}s`;
}
