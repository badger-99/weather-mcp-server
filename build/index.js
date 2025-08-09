import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
function getServer() {
    const NWS_API_BASE = "https://api.weather.gov";
    const USER_AGENT = "weather-app/0.1";
    // Create server instance
    const server = new McpServer({
        name: "weather",
        version: "1.0.0",
        capabilities: {
            resources: {},
            tools: {},
        }
    });
    // Helper function for making NWS API requests
    async function makeNWSRequest(url) {
        const headers = {
            "User-Agent": USER_AGENT,
            Accept: "application/geo+json",
        };
        try {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return (await response.json());
        }
        catch (error) {
            console.error("Error making NES request:", error);
            return null;
        }
    }
    // Format alert data
    function formatAlert(feature) {
        const props = feature.properties;
        return [
            `Event: ${props.event || "Unknown"}`,
            `Area: ${props.areaDesc || "Unkown"}`,
            `Severity: ${props.severity || "Unkown"}`,
            `Status: ${props.status || "Unknown"}`,
            `Headline: ${props.headline || "Unknown"}`,
            "---",
        ].join("\n");
    }
    // Register weather tool: get_alerts
    server.tool("get_alerts", "Get weather alerts for a state", {
        state: z.string().length(2).describe("Two-letter state code (e.g. TX, FL, WY)"),
    }, async ({ state }) => {
        const stateCode = state.toUpperCase();
        const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
        const alertsData = await makeNWSRequest(alertsUrl);
        if (!alertsData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve alerts data",
                    },
                ],
            };
        }
        const features = alertsData.features || [];
        if (features.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No active alerts for ${stateCode}`,
                    },
                ],
            };
        }
        const formattedAlerts = features.map(formatAlert);
        const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;
        return {
            content: [
                {
                    type: "text",
                    text: alertsText,
                },
            ],
        };
    });
    // Register weather tool: get_forecast
    server.tool("get_forecast", "Get weather forecast for a location", {
        latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
        longitude: z.number().min(-180).max(180).describe("longitude of the location"),
    }, async ({ latitude, longitude }) => {
        // Get grid point data
        const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        const pointsData = await makeNWSRequest(pointsUrl);
        if (!pointsData) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to retrieve grid point data for coordinates:${latitude},${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
                    },
                ],
            };
        }
        const forecastUrl = pointsData.properties?.forecast;
        if (!forecastUrl) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to get forecast URK from grid point data",
                    },
                ],
            };
        }
        // Get forecast data
        const forecastData = await makeNWSRequest(forecastUrl);
        if (!forecastData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve forecast data",
                    },
                ],
            };
        }
        const periods = forecastData.properties?.periods || [];
        if (periods.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No forecast periods available.",
                    },
                ],
            };
        }
        // Format forecast periods
        const formattedForecast = periods.map((period) => [
            `${period.name || "Unknown"}:`,
            `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
            `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
            `${period.shortForecast || "No forecast available"}`,
            "---",
        ].join("\n"));
        const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;
        return {
            content: [
                {
                    type: "text",
                    text: forecastText,
                },
            ],
        };
    });
    return server;
}
// Create an Express app to handle HTTP requests
const app = express();
app.use(cors()); // Allow cross-origin requests from VS code
app.use(express.json()); // Parse JSON request bodies
// This will handle all MCP protocol messages
app.post('/mcp', async (req, res) => {
    try {
        // Handle MCP request
        const server = getServer();
        // Create HTTP transport layer to make this server remote
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined // No session_id to make this a stateless server
        });
        res.on("close", () => {
            console.error("Request closed");
            transport.close();
            server.close();
        });
        await server.connect(transport); // Connect terver to remote transport layer
        await transport.handleRequest(req, res);
    }
    catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal server error",
                },
                id: null,
            });
        }
    }
});
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});
