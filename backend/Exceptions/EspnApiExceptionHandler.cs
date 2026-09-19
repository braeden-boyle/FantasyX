using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace FantasyX.Backend.Exceptions;

public class EspnApiExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not EspnApiException espnApiException)
        {
            return false;
        }

        httpContext.Response.StatusCode = (int)espnApiException.StatusCode;
        await httpContext.Response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Status = (int)espnApiException.StatusCode,
                Title = espnApiException.Message,
            },
            cancellationToken);

        return true;
    }
}
