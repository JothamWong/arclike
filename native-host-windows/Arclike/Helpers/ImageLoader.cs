using System;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Arclike.Helpers
{
    public static class ImageLoader
    {
        /// <summary>
        /// Decode an image from a data URL or an http(s) URL at `pixelWidth`, or return null. Data
        /// URLs decode now and are frozen, so any thread may create them. A web URL downloads in
        /// the background. WPF cannot decode SVG, so an SVG favicon gives null.
        /// </summary>
        public static ImageSource? Load(string? url, int pixelWidth)
        {
            if (string.IsNullOrEmpty(url)) return null;
            try
            {
                var image = new BitmapImage();
                image.BeginInit();
                image.DecodePixelWidth = pixelWidth;
                image.CacheOption = BitmapCacheOption.OnLoad;
                if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    if (url.StartsWith("data:image/svg", StringComparison.OrdinalIgnoreCase)) return null;
                    var comma = url.IndexOf(',');
                    if (comma < 0) return null;
                    image.StreamSource = new MemoryStream(Convert.FromBase64String(url[(comma + 1)..]));
                }
                else if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https"))
                {
                    if (uri.AbsolutePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) return null;
                    image.UriSource = uri;
                }
                else
                {
                    return null;
                }
                image.EndInit();
                if (image.CanFreeze && !image.IsDownloading) image.Freeze();
                return image;
            }
            catch
            {
                return null;
            }
        }
    }
}
