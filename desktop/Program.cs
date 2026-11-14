using System.ComponentModel;
using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LOLsito.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new DashboardWindow());
    }
}

internal sealed class DashboardWindow : Form
{
    private const string AppHost = "lolsito.local";
    private const string AppUrl = "https://" + AppHost;
    private const string LocalWardsUrl = "/data/wards-local.json";
    private const int MaxLocalFileSize = 64 * 1024 * 1024;
    private static readonly string SiteDirectory = Path.Combine(AppContext.BaseDirectory, "site");
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LOLsito");

    private readonly WebView2 view = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.FromArgb(17, 21, 19)
    };

    internal DashboardWindow()
    {
        Text = "LOLsito";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(480, 440);
        var workArea = Screen.PrimaryScreen?.WorkingArea.Size ?? new Size(1240, 850);
        Size = new Size(Math.Min(1280, workArea.Width - 32), Math.Min(900, workArea.Height - 32));
        BackColor = view.DefaultBackgroundColor;
        Controls.Add(view);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            if (!File.Exists(Path.Combine(SiteDirectory, "index.html")))
                throw new IOException("No se encontró la carpeta de archivos de LOLsito.");

            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(DataDirectory, "WebView2"));
            if (IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;

            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.IsStatusBarEnabled = false;

            core.NavigationStarting += PreventExternalNavigation;
            core.NewWindowRequested += (_, request) =>
            {
                request.Handled = true;
                if (request.IsUserInitiated) OpenExternalPage(request.Uri);
            };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += ServeLocalContent;
            core.Navigate(AppUrl + "/index.html?desktop=1");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowStartupError("Instalá Microsoft Edge WebView2 Runtime y volvé a abrir LOLsito.");
        }
        catch (Exception error)
        {
            if (!IsDisposed) ShowStartupError("No se pudo iniciar LOLsito. " + error.Message);
        }
    }

    private void PreventExternalNavigation(object? sender, CoreWebView2NavigationStartingEventArgs request)
    {
        if (IsAppUrl(request.Uri, out _)) return;
        request.Cancel = true;
        if (request.IsUserInitiated) OpenExternalPage(request.Uri);
    }

    private static bool IsAppUrl(string value, out Uri uri)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var parsed)
            && parsed.Scheme == Uri.UriSchemeHttps && parsed.Host == AppHost && parsed.IsDefaultPort)
        {
            uri = parsed;
            return true;
        }
        uri = null!;
        return false;
    }

    private void OpenExternalPage(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrEmpty(uri.Host) || uri.Host == AppHost) return;
        try
        {
            using var process = Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Win32Exception)
        {
            MessageBox.Show(this, "No se pudo abrir el enlace en el navegador predeterminado.", Text,
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private static (Stream? Body, int Status, string Reason, string Headers) EmptyResponse(int status, string reason) =>
        (null, status, reason, "Cache-Control: no-store");

    private void ServeLocalContent(object? sender, CoreWebView2WebResourceRequestedEventArgs request)
    {
        if (sender is not CoreWebView2 core || IsDisposed || Disposing) return;
        var response = EmptyResponse(403, "Forbidden");
        if (request.Request.Method == "GET" && IsAppUrl(request.Request.Uri, out var uri))
        {
            try
            {
                response = ReadAppFile(uri.AbsolutePath);
            }
            catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
            {
                response = EmptyResponse(404, "Not Found");
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                response = EmptyResponse(500, "Cannot Read File");
            }
        }
        request.Response = core.Environment.CreateWebResourceResponse(
            response.Body, response.Status, response.Reason, response.Headers);
    }

    private static (Stream? Body, int Status, string Reason, string Headers) ReadAppFile(string urlPath)
    {
        if (urlPath == "/") urlPath = "/index.html";
        var isWardFile = urlPath == LocalWardsUrl;
        var localPath = isWardFile
            ? Path.Combine(DataDirectory, "wards-local.json")
            : Path.GetFullPath(Path.Combine(SiteDirectory, Uri.UnescapeDataString(urlPath[1..])));
        if (!isWardFile && !localPath.StartsWith(SiteDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return EmptyResponse(404, "Not Found");

        var contentType = Path.GetExtension(localPath).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".woff2" => "font/woff2",
            _ => null
        };
        if (contentType == null) return EmptyResponse(404, "Not Found");

        using var file = new FileStream(localPath, FileMode.Open, FileAccess.Read,
            FileShare.Read | FileShare.Delete);
        if (file.Length > MaxLocalFileSize) return EmptyResponse(413, "File Too Large");
        var contents = new byte[file.Length];
        file.ReadExactly(contents);
        var headers = $"Content-Type: {contentType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
        return (new MemoryStream(contents, writable: false), 200, "OK", headers);
    }

    private void ShowStartupError(string message)
    {
        MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }
}
