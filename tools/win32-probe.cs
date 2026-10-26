using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int idx);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);

  /** MOUSEEVENTF_MOVE = 0x0001：原地来回 1 个单位，够让 GetLastInputInfo 刷新，光标不会真的跑掉 */
  public static void Nudge() {
    mouse_event(0x0001, 1, 0, 0, UIntPtr.Zero);
    mouse_event(0x0001, -1, 0, 0, UIntPtr.Zero);
  }

  public static int PidOf(IntPtr h) {
    uint pid = 0;
    GetWindowThreadProcessId(h, out pid);
    return (int)pid;
  }
  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassNameW(h, sb, 255);
    return sb.ToString();
  }
  /** GA_ROOTOWNER = 2：把任务栏那种「子窗口被命中」归一到顶层窗口 */
  public static IntPtr RootOf(IntPtr h) { return GetAncestor(h, 2); }
}
