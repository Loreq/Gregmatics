using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>JSON text in the shape the plan files already use.</summary>
    internal static class JsonText
    {
        // Lists of plain values shorter than this stay on one line. editor/core/core.js uses the same width.
        const int Inline = 100;

        /// <summary>How Python's repr would show a JSON value, for a message the page displays.</summary>
        public static string Repr(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null)
                return "None";
            if (token.Type == JTokenType.Boolean)
                return token.Value<bool>() ? "True" : "False";
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
                return Convert.ToString(((JValue)token).Value, CultureInfo.InvariantCulture);
            if (token.Type == JTokenType.String)
                return Quote(token.Value<string>());
            return token.ToString(Formatting.None);
        }

        /// <summary>A string in single quotes, as Python writes it.</summary>
        public static string Quote(string text)
        {
            var shown = new StringBuilder("'");
            foreach (char ch in text ?? "")
            {
                if (ch == '\\' || ch == '\'')
                    shown.Append('\\');
                shown.Append(ch);
            }
            shown.Append('\'');
            return shown.ToString();
        }

        /// <summary>Whether a JSON value counts as present, the way Python treats it.</summary>
        public static bool Truthy(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null)
                return false;
            if (token.Type == JTokenType.Boolean)
                return token.Value<bool>();
            if (token.Type == JTokenType.Integer)
                return token.Value<long>() != 0;
            if (token.Type == JTokenType.Float)
                return token.Value<double>() != 0;
            if (token.Type == JTokenType.String)
                return token.Value<string>().Length > 0;
            var array = token as JArray;
            if (array != null)
                return array.Count > 0;
            var obj = token as JObject;
            return obj == null || obj.Count > 0;
        }

        /// <summary>The plan's text: one key per line, and short lists of plain values on one line.</summary>
        public static string Dumps(JToken value, int indent = 0)
        {
            var obj = value as JObject;
            if (obj != null)
                return DumpObject(obj, indent);
            var array = value as JArray;
            if (array != null)
                return DumpList(array, indent);
            return JsonConvert.SerializeObject(value);
        }

        /// <summary>An object, one key per line.</summary>
        static string DumpObject(JObject value, int indent)
        {
            if (value.Count == 0)
                return "{}";
            string inner = new string(' ', (indent + 1) * 2);
            var items = new List<string>();
            foreach (JProperty prop in value.Properties())
                items.Add(inner + JsonConvert.SerializeObject(prop.Name) + ": " + Dumps(prop.Value, indent + 1));
            return "{\n" + string.Join(",\n", items) + "\n" + new string(' ', indent * 2) + "}";
        }

        /// <summary>A list: on one line when it is short and plain, otherwise one item per line.</summary>
        static string DumpList(JArray value, int indent)
        {
            if (value.Count == 0)
                return "[]";
            string flat = InlineList(value);
            if (flat != null)
                return flat;
            string inner = new string(' ', (indent + 1) * 2);
            var items = new List<string>();
            foreach (JToken item in value)
                items.Add(inner + Dumps(item, indent + 1));
            return "[\n" + string.Join(",\n", items) + "\n" + new string(' ', indent * 2) + "]";
        }

        /// <summary>A list of plain values on one line, or null when it holds a list or an object, or runs too long.</summary>
        static string InlineList(JArray value)
        {
            foreach (JToken item in value)
            {
                if (item is JObject || item is JArray)
                    return null;
            }
            var parts = new List<string>();
            foreach (JToken item in value)
                parts.Add(JsonConvert.SerializeObject(item));
            string flat = "[" + string.Join(", ", parts) + "]";
            return flat.Length <= Inline ? flat : null;
        }
    }
}
