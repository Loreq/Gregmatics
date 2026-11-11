using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>The editor/data.js the page loads: the version, the plan, and the catalog.</summary>
    internal static class EditorData
    {
        const string Header = "// Written from the plan and catalog/. Do not edit; run py -3 python/generate.py for the sheets.\n";

        /// <summary>The script the page loads. No plan text means the page opens on the New dialog.</summary>
        public static string Script(string text, Catalog catalog)
        {
            var body = new JObject
            {
                ["app"] = Version(),
                ["version"] = string.IsNullOrEmpty(text) ? "" : Files.Fingerprint(text),
                ["layout"] = string.IsNullOrEmpty(text) ? JValue.CreateNull() : JToken.Parse(text),
                ["catalog"] = CatalogJson(catalog),
            };
            return Header + "window.BASE = " + body.ToString(Newtonsoft.Json.Formatting.None) + ";\n";
        }

        /// <summary>The catalog the editor lists, in the order the files give.</summary>
        static JObject CatalogJson(Catalog catalog)
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
            return new JObject
            {
                ["multis"] = multis,
                ["singles"] = singles,
                ["groups"] = groups,
                ["elevator"] = catalog.ElevatorReach,
                ["voltage"] = new JArray(Catalog.Voltage),
                ["selectable"] = new JArray(Catalog.Voltage),
            };
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
