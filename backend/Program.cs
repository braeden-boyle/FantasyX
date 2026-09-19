using FantasyX.Backend.Exceptions;
using FantasyX.Backend.Services;

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

var app = builder.Build();

// Configure the HTTP request pipeline.

app.UseExceptionHandler();

app.UseHttpsRedirection();

app.UseCors(FrontendCorsPolicy);

app.UseAuthorization();

app.MapControllers();

app.Run();
