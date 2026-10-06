using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace FantasyX.Backend.Filters;

// Guards the snapshot write endpoint: the request's X-Capture-Key header must match the
// Snapshots:CaptureKey setting (user-secrets locally, an environment variable in the capture
// workflow). A missing or wrong key gets 401. With no key configured the endpoint answers 404, so
// a backend hosted without one never exposes an open write endpoint. It runs as an authorization
// filter, before the body is bound and validated.
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireCaptureKeyAttribute : Attribute, IAuthorizationFilter
{
    private const string HeaderName = "X-Capture-Key";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var configured = context.HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()["Snapshots:CaptureKey"];
        if (string.IsNullOrEmpty(configured))
        {
            context.Result = new NotFoundResult();
            return;
        }

        var supplied = context.HttpContext.Request.Headers[HeaderName].ToString();
        if (supplied.Length == 0 || !KeysMatch(configured, supplied))
        {
            context.Result = new UnauthorizedResult();
        }
    }

    // Compares hashes in constant time, so neither the key's contents nor its length leak through
    // how long a wrong guess takes.
    private static bool KeysMatch(string expected, string actual) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(actual)));
}
