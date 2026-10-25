using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Arclike.Helpers;
using Arclike.Models;

namespace Arclike.Views
{
    /// <summary>
    /// Floating overlay for the tab switcher. Port of TabSwitcherWindow and TabSwitcherView in
    /// main.swift. It never takes focus from the browser (ShowActivated=False, WS_EX_NOACTIVATE),
    /// because releasing the switch modifier in the browser is what ends the switch.
    /// </summary>
    public partial class TabSwitcherOverlay : Window
    {
        private readonly ObservableCollection<TabViewModel> _topRow = new();
        private readonly ObservableCollection<TabViewModel> _bottomRow = new();
        private TabViewModel[] _tabs = Array.Empty<TabViewModel>();
        private Win32.POINT _cursorAtShow;

        /// <summary>Sends a message to the extension.</summary>
        public Action<object>? Send { get; set; }

        public TabSwitcherOverlay()
        {
            InitializeComponent();
            TopRow.ItemsSource = _topRow;
            BottomRow.ItemsSource = _bottomRow;
            SourceInitialized += (s, e) =>
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                Win32.AddExtendedStyle(hwnd, Win32.WS_EX_NOACTIVATE | Win32.WS_EX_TOOLWINDOW);
            };
        }

        /// <summary>
        /// Show the switcher over `browserWindow`. Port of TabSwitcherState.showSwitcher and the
        /// placement in AppDelegate.
        /// </summary>
        public void ShowSwitcher(TabInfo[] tabs, int selectedIndex, IntPtr browserWindow)
        {
            if (tabs.Length == 0) return;

            var target = WindowPlacement.ForWindow(browserWindow) ?? WindowPlacement.ForCursorMonitor();
            double scale = target.Scale;
            double frameWidth = target.Frame.Width / scale;
            double maxWidth = Math.Min(frameWidth - 40, Constants.MaxOverlayWidth);
            var layout = SwitcherLayout.Compute(tabs.Length, maxWidth);

            _tabs = tabs.Select((tab, i) => new TabViewModel(tab, i, i == selectedIndex, layout)).ToArray();
            _topRow.Clear();
            _bottomRow.Clear();
            int topCount = layout.RowSizes.Count > 0 ? layout.RowSizes[0] : 0;
            foreach (var vm in _tabs.Take(topCount)) _topRow.Add(vm);
            foreach (var vm in _tabs.Skip(topCount)) _bottomRow.Add(vm);
            BottomRow.Visibility = _bottomRow.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            double width = Math.Min(layout.ContentWidth, maxWidth);
            double height = layout.ContentHeight;

            // Centered on the browser window, a little above the middle, kept on its monitor.
            var frame = target.Frame;
            var work = target.WorkArea;
            int widthPx = (int)Math.Round(width * scale);
            int heightPx = (int)Math.Round(height * scale);
            int x = frame.Left + (frame.Width - widthPx) / 2;
            int y = frame.Top + (frame.Height - heightPx) / 2 - (int)(frame.Height * 0.08);
            x = WindowPlacement.Clamp(x, widthPx, work.Left, work.Right);
            y = WindowPlacement.Clamp(y, heightPx, work.Top, work.Bottom);

            // Move first, so WPF takes the target monitor's scale before the size is set.
            WindowPlacement.MoveTo(this, x, y);
            Width = width;
            Height = height;
            WindowPlacement.MoveTo(this, x, y);

            Win32.GetCursorPos(out _cursorAtShow);
            Show();
            DebugLogger.Log($"Showing switcher: {tabs.Length} tabs, rows=[{string.Join(",", layout.RowSizes)}], card={layout.CardWidth}x{layout.CardHeight}, at {x},{y} scale={scale}");
        }

        public void UpdateSelection(int selectedIndex)
        {
            foreach (var vm in _tabs)
                vm.IsSelected = vm.Index == selectedIndex;
        }

        public void HideSwitcher()
        {
            if (!IsVisible) return;
            Hide();
            // Release the previews, as main.swift does on hide.
            _topRow.Clear();
            _bottomRow.Clear();
            _tabs = Array.Empty<TabViewModel>();
            DebugLogger.Log("Hiding switcher");
        }

        /// <summary>
        /// Hover selects a card and tells the extension, so releasing the modifier switches to it.
        /// It waits until the cursor moves, so a card that appears under a resting cursor is not
        /// selected by accident.
        /// </summary>
        private void Card_MouseMove(object sender, MouseEventArgs e)
        {
            if (sender is not FrameworkElement { DataContext: TabViewModel vm } || vm.IsSelected) return;
            Win32.GetCursorPos(out var now);
            if (Math.Abs(now.X - _cursorAtShow.X) < 2 && Math.Abs(now.Y - _cursorAtShow.Y) < 2) return;

            UpdateSelection(vm.Index);
            DebugLogger.Log($"Hover selected index {vm.Index}");
            Send?.Invoke(new { action = "select_tab", tabId = vm.Id });
        }
    }

    public class TabViewModel : INotifyPropertyChanged
    {
        private bool _isSelected;

        public int Id { get; }
        public int Index { get; }
        public string Title { get; }
        public BitmapImage? Thumbnail { get; }
        public ImageSource? Favicon { get; }
        public double CardWidth { get; }
        public double CardHeight { get; }

        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                if (_isSelected == value) return;
                _isSelected = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsSelected)));
            }
        }

        public TabViewModel(TabInfo tab, int index, bool isSelected, SwitcherLayout layout)
        {
            Id = tab.Id;
            Index = index;
            Title = tab.Title;
            Thumbnail = tab.Thumbnail;
            Favicon = ImageLoader.Load(tab.FavIconUrl, 72);
            CardWidth = layout.CardWidth;
            CardHeight = layout.CardHeight;
            _isSelected = isSelected;
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
