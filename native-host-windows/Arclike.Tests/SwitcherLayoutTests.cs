using Arclike.Models;
using Xunit;

public class SwitcherLayoutTests
{
    [Theory]
    [InlineData(1, new[] { 1 })]
    [InlineData(5, new[] { 5 })]
    [InlineData(6, new[] { 3, 3 })]
    [InlineData(7, new[] { 4, 3 })]
    [InlineData(8, new[] { 4, 4 })]
    [InlineData(9, new[] { 5, 4 })]
    public void SplitsIntoRowsLikeTheMacApp(int tabs, int[] rows)
    {
        Assert.Equal(rows, SwitcherLayout.Compute(tabs, 1200).RowSizes);
    }

    [Fact]
    public void KeepsFullSizeCardsWhenTheyFit()
    {
        var layout = SwitcherLayout.Compute(3, 1200);
        Assert.Equal(220, layout.CardWidth);
        Assert.Equal(146, layout.CardHeight);
        Assert.Equal(3 * 220 + 2 * 12 + 2 * 16, layout.ContentWidth);
        Assert.Equal(146 + 2 * 16, layout.ContentHeight);
    }

    [Fact]
    public void ShrinksCardsToTheWidthButNotBelowTheMinimumScale()
    {
        var narrow = SwitcherLayout.Compute(5, 800);
        Assert.True(narrow.CardWidth < 220);
        Assert.True(narrow.ContentWidth <= 800);

        var tiny = SwitcherLayout.Compute(5, 100);
        Assert.Equal(System.Math.Floor(220 * SwitcherLayout.MinScale), tiny.CardWidth);
    }

    [Fact]
    public void TwoRowsAddSpacingBetweenThem()
    {
        var layout = SwitcherLayout.Compute(6, 1200);
        Assert.Equal(2 * 146 + 12 + 2 * 16, layout.ContentHeight);
    }

    [Fact]
    public void NoTabsGiveAnEmptyLayout()
    {
        var layout = SwitcherLayout.Compute(0, 1200);
        Assert.Empty(layout.RowSizes);
        Assert.Equal(0, layout.ContentWidth);
    }
}
