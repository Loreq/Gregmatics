using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>The editor/data.js the page loads: the version, the plan, and the catalog.</summary>
    internal static class EditorData
    {
        const string Header = "// Written from the plan and catalog/. Do not edit; run py -3 python/generate.py for the sheets.\n";

        /// <summary>The script the page loads, for one plan's text.</summary>
        public static string Script(string text, Catalog catalog)
        {
            var multis = new JObject();
            foreach (string key in catalog.MultiOrder)
                multis[key] = catalog.Multis[key].Editor();
            var singles = new JObject();
            foreach (string code in catalog.SingleOrder)
                singles[code] = catalog.Singles[code].Editor();
            var groups = new JObject();
            foreach (string id in catalog.GroupOrder)
                groups[id] = catalog.Groups[id];
            var body = new JObject
            {
                ["app"] = Version(),
                ["version"] = Files.Fingerprint(text),
                ["layout"] = JToken.Parse(text),
                ["catalog"] = new JObject
                {
                    ["multis"] = multis,
                    ["singles"] = singles,
                    ["groups"] = groups,
                    ["elevator"] = catalog.ElevatorReach,
                    ["voltage"] = new JArray(Catalog.Voltage),
                    ["selectable"] = new JArray(Catalog.Voltage),
                },
            };
            return Header + "window.BASE = " + body.ToString(Newtonsoft.Json.Formatting.None) + ";\n";
        }

        /// <summary>The program version, from the assembly.</summary>
        static string Version()
        {
            System.Version version = Assembly.GetExecutingAssembly().GetName().Version;
            int build = version.Build < 0 ? 0 : version.Build;
            return version.Major + "." + version.Minor + "." + build;
        }
    }
}
