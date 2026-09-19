using System.Net;

namespace FantasyX.Backend.Exceptions;

public class EspnApiException(HttpStatusCode statusCode, string message) : Exception(message)
{
    public HttpStatusCode StatusCode { get; } = statusCode;
}
