using System;
using System.Collections.Generic;
using System.Linq;

namespace Arclike.Models
{
    /// <summary>
    /// Card arrangement for a given tab count. Port of SwitcherLayout in main.swift. Up to 5 tabs
    /// sit in one row. From 6 on, cards split into two rows with the extra card on top
    /// (6 → 3+3, 7 → 4+3, 8 → 4+4, 9 → 5+4, …). Cards shrink when a row would be wider than the
    /// space available. All sizes are device-independent units.
    /// </summary>
    public sealed record SwitcherLayout(IReadOnlyList<int> RowSizes, double CardWidth, double CardHeight)
    {
        public const double BaseCardWidth = 220;
        public const double BaseCardHeight = 146;
        public const double Spacing = 12;
        public const double Padding = 16;
        public const double MinScale = 0.6;

        public static SwitcherLayout Compute(int tabCount, double maxWidth)
        {
            if (tabCount <= 0) return new SwitcherLayout(Array.Empty<int>(), BaseCardWidth, BaseCardHeight);

            int[] rows = tabCount >= 6
                ? new[] { (tabCount + 1) / 2, tabCount - (tabCount + 1) / 2 }
                : new[] { tabCount };
            int columns = rows.Max();
            double available = maxWidth - Padding * 2 - (columns - 1) * Spacing;
            double scale = Math.Min(1, Math.Max(MinScale, available / (columns * BaseCardWidth)));
            return new SwitcherLayout(rows, Math.Floor(BaseCardWidth * scale), Math.Floor(BaseCardHeight * scale));
        }

        public int Columns => RowSizes.Count == 0 ? 0 : RowSizes.Max();

        public double ContentWidth => Columns == 0 ? 0 : Columns * CardWidth + (Columns - 1) * Spacing + Padding * 2;

        public double ContentHeight
        {
            get
            {
                int rows = RowSizes.Count(r => r > 0);
                return rows == 0 ? 0 : rows * CardHeight + (rows - 1) * Spacing + Padding * 2;
            }
        }
    }
}
