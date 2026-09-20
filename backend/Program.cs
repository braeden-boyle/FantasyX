using FantasyX.Backend.Data;
using FantasyX.Backend.Exceptions;
using FantasyX.Backend.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

const string FrontendCorsPolicy = "FrontendCorsPolicy";

// Add services to the container.

builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
        policy.WithOrigins(builder.Configuration["Cors:AllowedOrigin"] ?? "http://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod());
});

builder.Services.AddHttpClient<IEspnFantasyService, EspnFantasyService>(client =>
{
    client.BaseAddress = new Uri(
        builder.Configuration["Espn:BaseUrl"] ?? throw new InvalidOperationException("Espn:BaseUrl is not configured"));
})
// ESPN redirects (302) rather than 404s a bad league ID; auto-redirect is disabled so
// EspnFantasyService can see that redirect itself and map it to a real error.
.ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

builder.Services.AddExceptionHandler<EspnApiExceptionHandler>();
builder.Services.AddProblemDetails();

var rawConnectionString = builder.Configuration.GetConnectionString("FantasyX")
    ?? throw new InvalidOperationException("ConnectionStrings:FantasyX is not configured");
builder.Services.AddDbContext<FantasyXDbContext>(options => options.UseNpgsql(NormalizePostgresConnectionString(rawConnectionString)));
builder.Services.AddDataProtection();
builder.Services.AddScoped<CredentialProtector>();
builder.Services.AddScoped<ICredentialsService, CredentialsService>();

var app = builder.Build();

// Configure the HTTP request pipeline.

app.UseExceptionHandler();

app.UseHttpsRedirection();

app.UseCors(FrontendCorsPolicy);

app.UseAuthorization();

app.MapControllers();

app.Run();

// Supabase's dashboard hands out a "postgres://user:pass@host:port/db" URI by default, but
// Npgsql's UseNpgsql expects the ADO.NET "Host=...;Username=...;Password=..." keyword format -
// accept either so pasting the dashboard's connection string directly just works.
static string NormalizePostgresConnectionString(string raw)
{
    raw = raw.Trim();

    if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
        && !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
    {
        return raw;
    }

    // Parsed manually instead of via System.Uri: System.Uri is strict about characters in the
    // userinfo/port segments and throws on things a Postgres password can legitimately contain.
    var withoutScheme = raw[(raw.IndexOf("://", StringComparison.Ordinal) + 3)..];

    var atIndex = withoutScheme.LastIndexOf('@');
    if (atIndex < 0)
    {
        throw new InvalidOperationException(
            "ConnectionStrings:FantasyX looks like a postgres:// URI but has no '@' separating credentials from the host.");
    }

    var userInfo = withoutScheme[..atIndex];
    var hostPart = withoutScheme[(atIndex + 1)..];

    var userColonIndex = userInfo.IndexOf(':');
    var username = userColonIndex < 0 ? userInfo : userInfo[..userColonIndex];
    var password = userColonIndex < 0 ? string.Empty : userInfo[(userColonIndex + 1)..];

    var slashIndex = hostPart.IndexOf('/');
    var hostAndPort = slashIndex < 0 ? hostPart : hostPart[..slashIndex];
    var database = slashIndex < 0 ? string.Empty : hostPart[(slashIndex + 1)..].Split('?')[0];

    var portColonIndex = hostAndPort.LastIndexOf(':');
    var host = portColonIndex < 0 ? hostAndPort : hostAndPort[..portColonIndex];
    var port = portColonIndex < 0 ? 5432 : int.Parse(hostAndPort[(portColonIndex + 1)..]);

    var csBuilder = new NpgsqlConnectionStringBuilder
    {
        Host = host,
        Port = port,
        Username = Uri.UnescapeDataString(username),
        Password = Uri.UnescapeDataString(password),
        Database = database,
        SslMode = SslMode.Require,
    };
    return csBuilder.ConnectionString;
}
