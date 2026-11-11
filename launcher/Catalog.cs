using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>GTNH 2.9.0 machine facts, from catalog/.</summary>
    internal sealed class Catalog
    {
        // GTNH 2.9.0 quest tabs, in QuestLinesOrder.txt order on the 2.9.0 tag.
        public static readonly string[] Voltage =
        {
            "Stone", "Steam", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV",
        };

        // The tier of a structure that has no voltage. Those are filed in other.json.
        const string NoTier = "-";

        public readonly Dictionary<string, Multi> Multis = new Dictionary<string, Multi>(StringComparer.Ordinal);
        public readonly List<string> MultiOrder = new List<string>();
        public readonly Dictionary<string, Single> Singles = new Dictionary<string, Single>(StringComparer.Ordinal);
        public readonly List<string> SingleOrder = new List<string>();
        public readonly Dictionary<string, string> Groups = new Dictionary<string, string>(StringComparer.Ordinal);
        public readonly List<string> GroupOrder = new List<string>();
        public int ElevatorReach;

        /// <summary>Load the catalog that sits in a source tree, beside the exe.</summary>
        public static Catalog FromTree(string root)
        {
            return Load(new DiskStore(root));
        }

        /// <summary>Load the catalog packed inside the exe.</summary>
        public static Catalog FromSite()
        {
            return Load(new PackedStore());
        }

        /// <summary>Voltages a machine slot may use, from LV on.</summary>
        public string[] Slot()
        {
            int start = Array.IndexOf(Voltage, "LV");
            var slot = new string[Voltage.Length - start];
            Array.Copy(Voltage, start, slot, 0, slot.Length);
            return slot;
        }

        /// <summary>Read every catalog file the editor needs.</summary>
        static Catalog Load(IStore store)
        {
            var catalog = new Catalog();
            catalog.ReadGroups(store);
            catalog.ReadMultis(store);
            catalog.ReadSingles(store);
            catalog.ElevatorReach = catalog.ReadElevator(store);
            return catalog;
        }

        /// <summary>Machine group id to its name, in the order the editor lists them.</summary>
        void ReadGroups(IStore store)
        {
            const string path = "catalog/groups.json";
            JObject data = ReadObject(store, path, "catalog/groups.json should be an object of group id to name");
            if (data.Count == 0)
                throw new CatalogException("catalog/groups.json should be an object of group id to name");
            foreach (JProperty prop in data.Properties())
            {
                if (prop.Value.Type != JTokenType.String || prop.Value.Value<string>().Trim().Length == 0)
                    throw new CatalogException("catalog/groups.json: " + JsonText.Quote(prop.Name) + " needs a name");
                Groups[prop.Name] = prop.Value.Value<string>();
                GroupOrder.Add(prop.Name);
            }
        }

        /// <summary>Every multiblock by key, lowest tier first.</summary>
        void ReadMultis(IStore store)
        {
            var paths = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string path in store.Files("catalog/multiblocks", ".json"))
                paths[TierName(Path.GetFileNameWithoutExtension(path))] = path;
            var order = new List<string>();
            foreach (string name in Voltage)
            {
                if (paths.ContainsKey(name))
                    order.Add(name);
            }
            if (paths.ContainsKey(NoTier))
                order.Add(NoTier);
            foreach (string tier in order)
            {
                int index = 0;
                foreach (JObject row in Rows(store, paths[tier]))
                {
                    string key;
                    string where;
                    Named(row, paths[tier], index, "key", out key, out where);
                    Known(row, MultiFields, where);
                    FiledUnder(row, where, "tier", tier);
                    Fresh(key, Multis, where, "key");
                    Multis[key] = Multi.Read(key, row, where, tier);
                    MultiOrder.Add(key);
                    index++;
                }
            }
        }

        /// <summary>Every singleblock machine by code, one file per group.</summary>
        void ReadSingles(IStore store)
        {
            var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string group in GroupOrder)
            {
                expected.Add(group + ".json");
                string path = "catalog/machines/" + group + ".json";
                if (!store.Exists(path))
                    throw new CatalogException("catalog/machines/" + group + ".json is missing. Add it, or take " + group + " out of groups.json.");
                int index = 0;
                foreach (JObject row in Rows(store, path))
                {
                    string code;
                    string where;
                    Named(row, path, index, "code", out code, out where);
                    Known(row, SingleFields, where);
                    FiledUnder(row, where, "group", group);
                    Fresh(code, Singles, where, "code");
                    Singles[code] = Single.Read(code, row, where, group);
                    SingleOrder.Add(code);
                    index++;
                }
            }
            foreach (string path in store.Files("catalog/machines", ".json"))
            {
                if (!expected.Contains(Path.GetFileName(path)))
                    throw new CatalogException("catalog/machines has files with no group in groups.json: " + Path.GetFileName(path));
            }
        }

        /// <summary>How far an elevator reaches.</summary>
        int ReadElevator(IStore store)
        {
            const string path = "catalog/elevator.json";
            JObject row = ReadObject(store, path, path + " should be an object");
            Known(row, new HashSet<string>(StringComparer.Ordinal) { "reach", "solid", "source" }, path);
            return Int(Need(row, "reach", path), path, "reach", 1);
        }

        /// <summary>The tier a multiblock file is for, from its name.</summary>
        static string TierName(string stem)
        {
            foreach (string name in Voltage)
            {
                if (string.Equals(stem, name, StringComparison.OrdinalIgnoreCase))
                    return name;
            }
            if (string.Equals(stem, "other", StringComparison.OrdinalIgnoreCase))
                return NoTier;
            throw new CatalogException("catalog/multiblocks/" + stem + ".json is not a tier file. Use " + string.Join(", ", Lower(Voltage)) + ", or other.json.");
        }

        static string[] Lower(string[] names)
        {
            var lower = new string[names.Length];
            for (int i = 0; i < names.Length; i++)
                lower[i] = names[i].ToLowerInvariant();
            return lower;
        }

        static readonly HashSet<string> MultiFields = new HashSet<string>(StringComparer.Ordinal)
        {
            "key", "name", "short", "tier", "size", "pollution", "muffler", "source",
            "gt", "shell", "front_air", "side_air", "sky", "share", "note", "span", "square", "odd", "fits",
        };

        static readonly HashSet<string> SingleFields = new HashSet<string>(StringComparer.Ordinal)
        {
            "code", "name", "group", "amps", "pollution", "gt", "note",
        };

        /// <summary>A catalog file as an object.</summary>
        static JObject ReadObject(IStore store, string path, string emptyMessage)
        {
            JToken data = Parse(store, path);
            var obj = data as JObject;
            if (obj == null)
                throw new CatalogException(emptyMessage);
            return obj;
        }

        /// <summary>A catalog file as parsed JSON.</summary>
        static JToken Parse(IStore store, string path)
        {
            try
            {
                return JToken.Parse(store.Read(path));
            }
            catch (JsonReaderException ex)
            {
                throw new CatalogException(path + " is not valid JSON: line " + ex.LineNumber + ": " + ex.Message);
            }
        }

        /// <summary>Each object of a catalog list.</summary>
        static IEnumerable<JObject> Rows(IStore store, string path)
        {
            JToken data = Parse(store, path);
            var list = data as JArray;
            if (list == null)
                throw new CatalogException(path + " should be a list");
            int index = 0;
            foreach (JToken item in list)
            {
                var row = item as JObject;
                if (row == null)
                    throw new CatalogException(path + "[" + index + "] should be an object");
                yield return row;
                index++;
            }
        }

        /// <summary>A row's key or code, and the label later messages use for the row.</summary>
        static void Named(JObject row, string path, int index, string field, out string name, out string where)
        {
            string unnamed = path + "[" + index + "] ?";
            name = Str(Need(row, field, unnamed), unnamed, field);
            where = path + "[" + index + "] " + name;
        }

        /// <summary>A row has to name the tier or group its file is for.</summary>
        static void FiledUnder(JObject row, string where, string field, string expected)
        {
            string got = Str(Need(row, field, where), where, field);
            if (got != expected)
                throw new CatalogException(where + ": " + field + " is " + got + ", this file is for " + expected);
        }

        /// <summary>A key or code may be used once.</summary>
        static void Fresh<T>(string name, Dictionary<string, T> taken, string where, string field)
        {
            if (taken.ContainsKey(name))
                throw new CatalogException(where + ": " + field + " " + name + " is already used");
        }

        /// <summary>Reject a field the loader does not know, so a typo is not silently dropped.</summary>
        static void Known(JObject row, HashSet<string> allowed, string where)
        {
            foreach (JProperty prop in row.Properties())
            {
                if (!allowed.Contains(prop.Name))
                    throw new CatalogException(where + ": unknown field " + prop.Name);
            }
        }

        /// <summary>A field the row has to have.</summary>
        static JToken Need(JObject row, string field, string where)
        {
            JProperty prop = row.Property(field);
            if (prop == null)
                throw new CatalogException(where + ": missing " + field);
            return prop.Value;
        }

        /// <summary>Text that is not blank.</summary>
        static string Str(JToken value, string where, string field)
        {
            if (value == null || value.Type != JTokenType.String || value.Value<string>().Trim().Length == 0)
                throw new CatalogException(where + ": " + field + " should be text");
            return value.Value<string>();
        }

        /// <summary>True or false, and nothing that merely acts like one.</summary>
        static bool Bool(JToken value, string where, string field)
        {
            if (value == null || value.Type != JTokenType.Boolean)
                throw new CatalogException(where + ": " + field + " should be true or false");
            return value.Value<bool>();
        }

        /// <summary>An optional true-or-false field.</summary>
        static bool Flag(JObject row, string where, string field, bool fallback)
        {
            JProperty prop = row.Property(field);
            return prop == null ? fallback : Bool(prop.Value, where, field);
        }

        /// <summary>A whole number of at least low.</summary>
        static int Int(JToken value, string where, string field, int low)
        {
            if (value == null || value.Type == JTokenType.Boolean || value.Type != JTokenType.Integer)
                throw new CatalogException(where + ": " + field + " should be a whole number of at least " + low);
            long number = value.Value<long>();
            if (number < low || number > int.MaxValue)
                throw new CatalogException(where + ": " + field + " should be a whole number of at least " + low);
            return (int)number;
        }

        /// <summary>A size: three whole numbers of at least 1.</summary>
        static int[] Triple(JToken value, string where, string field)
        {
            var list = value as JArray;
            if (list == null || list.Count != 3)
                throw new CatalogException(where + ": " + field + " should be three whole numbers");
            return new[] { Int(list[0], where, field, 1), Int(list[1], where, field, 1), Int(list[2], where, field, 1) };
        }

        /// <summary>Two whole numbers of at least 1.</summary>
        static int[] Pair(JToken value, string where, string field)
        {
            var list = value as JArray;
            if (list == null || list.Count != 2)
                throw new CatalogException(where + ": " + field + " should be two whole numbers");
            return new[] { Int(list[0], where, field, 1), Int(list[1], where, field, 1) };
        }

        /// <summary>Four or six whole numbers, each low before its high.</summary>
        static int[] Span(JToken value, string where)
        {
            var list = value as JArray;
            if (list == null || (list.Count != 4 && list.Count != 6))
                throw new CatalogException(where + ": span should be four or six whole numbers");
            var nums = new int[list.Count];
            for (int i = 0; i < list.Count; i++)
                nums[i] = Int(list[i], where, "span", 1);
            for (int i = 0; i < nums.Length; i += 2)
            {
                if (nums[i] > nums[i + 1])
                    throw new CatalogException(where + ": span should list each low before its high");
            }
            return nums;
        }

        /// <summary>One or more sizes.</summary>
        static int[][] Fits(JToken value, string where)
        {
            var list = value as JArray;
            if (list == null || list.Count == 0)
                throw new CatalogException(where + ": fits should list one or more sizes");
            var fits = new int[list.Count][];
            for (int i = 0; i < list.Count; i++)
                fits[i] = Triple(list[i], where, "fits");
            return fits;
        }

        /// <summary>An optional note. Missing reads as no note.</summary>
        static string Note(JObject row, string where)
        {
            JProperty prop = row.Property("note");
            if (prop == null || prop.Value.Type == JTokenType.Null || !JsonText.Truthy(prop.Value))
                return "";
            if (prop.Value.Type != JTokenType.String)
                throw new CatalogException(where + ": note should be text");
            return prop.Value.Value<string>();
        }
    }

    /// <summary>One multiblock: its name, its tier, and the sizes the wiki allows it.</summary>
    internal sealed class Multi
    {
        public string Key;
        public string Name;
        public string Short;
        public string Tier;
        public int[] Size;
        public int Pollution;
        public bool Shell;
        public bool Share;
        public bool Sky;
        public string Note = "";
        public int[] Span = new int[0];
        public bool Square;
        public bool Odd;
        public int[][] Fits = new int[0][];

        /// <summary>One multiblock from its row.</summary>
        public static Multi Read(string key, JObject row, string where, string tier)
        {
            int[] span = row.Property("span") != null ? CatalogSpan(row["span"], where) : new int[0];
            if (row.Property("fits") != null && row.Property("span") != null)
                throw new CatalogException(where + ": use span or fits, not both");
            int[][] fits = row.Property("fits") != null ? CatalogFits(row["fits"], where) : new int[0][];
            if (span.Length == 0 && (row.Property("square") != null || row.Property("odd") != null))
                throw new CatalogException(where + ": square and odd describe a span");
            var multi = new Multi
            {
                Key = key,
                Name = NeedStr(row, "name", where),
                Short = NeedStr(row, "short", where),
                Tier = tier,
                Size = CatalogTriple(Need(row, "size", where), where, "size"),
                Pollution = row.Property("pollution") == null ? 0 : CatalogInt(row["pollution"], where, "pollution", 0),
                Shell = Flag(row, where, "shell"),
                Share = Flag(row, where, "share"),
                Sky = Flag(row, where, "sky"),
                Note = CatalogNote(row, where),
                Span = span,
                Square = Flag(row, where, "square"),
                Odd = Flag(row, where, "odd"),
                Fits = fits,
            };
            if (!multi.Allows(multi.Size[0], multi.Size[1], multi.Size[2]))
                throw new CatalogException(where + ": size " + Times(multi.Size) + " is not one of the sizes it allows (" + multi.SizeText() + ")");
            return multi;
        }

        /// <summary>Whether one module can be built this size. A turn swaps width and depth.</summary>
        public bool Allows(int wide, int deep, int high)
        {
            if (Fits.Length > 0)
                return HasFit(wide, deep, high) || HasFit(deep, wide, high);
            if (Span.Length == 0)
                return SamePair(wide, deep, Size[0], Size[1]) && high == Size[2];
            return InSpan(wide, deep, high);
        }

        /// <summary>What the editor reads about this multiblock.</summary>
        public JObject Editor()
        {
            var entry = new JObject
            {
                ["name"] = Name,
                ["short"] = Short,
                ["tier"] = Tier,
                ["size"] = new JArray(Size[0], Size[1], Size[2]),
                ["pollution"] = Pollution,
                ["shell"] = Shell,
                ["sky"] = Sky,
                ["share"] = Share,
            };
            if (Span.Length > 0)
                entry["span"] = new JArray(Span);
            if (Square)
                entry["square"] = true;
            if (Odd)
                entry["odd"] = true;
            if (Fits.Length > 0)
            {
                var fits = new JArray();
                foreach (int[] fit in Fits)
                    fits.Add(new JArray(fit[0], fit[1], fit[2]));
                entry["fits"] = fits;
            }
            if (Note.Length > 0)
                entry["note"] = Note;
            return entry;
        }

        /// <summary>Whether a length sits in a (low, high) range, and is odd when it has to be.</summary>
        static bool Within(int n, int low, int high, bool odd)
        {
            return low <= n && n <= high && (!odd || n % 2 == 1);
        }

        /// <summary>Whether a size sits inside the ranges of span, either way round.</summary>
        bool InSpan(int wide, int deep, int high)
        {
            int[] x;
            int[] z;
            int[] h;
            Ranges(out x, out z, out h);
            if (Square && wide != deep)
                return false;
            if (high < h[0] || high > h[1])
                return false;
            bool direct = Within(wide, x[0], x[1], Odd) && Within(deep, z[0], z[1], Odd);
            bool turned = Within(wide, z[0], z[1], Odd) && Within(deep, x[0], x[1], Odd);
            return direct || turned;
        }

        /// <summary>Width, depth, and height from span, each as (low, high).</summary>
        void Ranges(out int[] x, out int[] z, out int[] h)
        {
            if (Span.Length == 4)
            {
                x = new[] { Span[0], Span[1] };
                z = new[] { Span[0], Span[1] };
                h = new[] { Span[2], Span[3] };
                return;
            }
            x = new[] { Span[0], Span[1] };
            z = new[] { Span[2], Span[3] };
            h = new[] { Span[4], Span[5] };
        }

        /// <summary>Whether the two sides match, in either order.</summary>
        static bool SamePair(int wide, int deep, int a, int b)
        {
            int low = Math.Min(wide, deep);
            int high = Math.Max(wide, deep);
            return low == Math.Min(a, b) && high == Math.Max(a, b);
        }

        /// <summary>Whether one of the listed sizes is this one.</summary>
        bool HasFit(int wide, int deep, int high)
        {
            foreach (int[] fit in Fits)
            {
                if (fit[0] == wide && fit[1] == deep && fit[2] == high)
                    return true;
            }
            return false;
        }

        /// <summary>The legal sizes, written the way the editor writes them.</summary>
        string SizeText()
        {
            if (Fits.Length > 0)
            {
                var parts = new List<string>();
                foreach (int[] fit in Fits)
                    parts.Add(Times(fit));
                return string.Join(", ", parts);
            }
            if (Span.Length == 0)
                return Times(Size);
            int[] x;
            int[] z;
            int[] h;
            Ranges(out x, out z, out h);
            string high = RangeText(h[0], h[1], false);
            if (Square)
                return RangeText(x[0], x[1], Odd) + " square × " + high;
            return RangeText(x[0], x[1], Odd) + "×" + RangeText(z[0], z[1], Odd) + "×" + high;
        }

        /// <summary>A (low, high) range in a few characters.</summary>
        static string RangeText(int low, int high, bool odd)
        {
            if (low == high)
                return low.ToString();
            if (!odd)
                return low + "–" + high;
            var parts = new List<string>();
            for (int n = low; n <= high; n++)
            {
                if (n % 2 == 1)
                    parts.Add(n.ToString());
            }
            return string.Join("/", parts);
        }

        /// <summary>Numbers joined the way a size is written: 3×3×4.</summary>
        static string Times(int[] numbers)
        {
            var parts = new string[numbers.Length];
            for (int i = 0; i < numbers.Length; i++)
                parts[i] = numbers[i].ToString();
            return string.Join("×", parts);
        }

        static JToken Need(JObject row, string field, string where)
        {
            JProperty prop = row.Property(field);
            if (prop == null)
                throw new CatalogException(where + ": missing " + field);
            return prop.Value;
        }

        static string NeedStr(JObject row, string field, string where)
        {
            JToken value = Need(row, field, where);
            if (value.Type != JTokenType.String || value.Value<string>().Trim().Length == 0)
                throw new CatalogException(where + ": " + field + " should be text");
            return value.Value<string>();
        }

        static bool Flag(JObject row, string where, string field)
        {
            JProperty prop = row.Property(field);
            if (prop == null)
                return false;
            if (prop.Value.Type != JTokenType.Boolean)
                throw new CatalogException(where + ": " + field + " should be true or false");
            return prop.Value.Value<bool>();
        }

        static int CatalogInt(JToken value, string where, string field, int low)
        {
            if (value == null || value.Type == JTokenType.Boolean || value.Type != JTokenType.Integer)
                throw new CatalogException(where + ": " + field + " should be a whole number of at least " + low);
            long number = value.Value<long>();
            if (number < low || number > int.MaxValue)
                throw new CatalogException(where + ": " + field + " should be a whole number of at least " + low);
            return (int)number;
        }

        static int[] CatalogTriple(JToken value, string where, string field)
        {
            var list = value as JArray;
            if (list == null || list.Count != 3)
                throw new CatalogException(where + ": " + field + " should be three whole numbers");
            return new[]
            {
                CatalogInt(list[0], where, field, 1),
                CatalogInt(list[1], where, field, 1),
                CatalogInt(list[2], where, field, 1),
            };
        }

        static int[] CatalogSpan(JToken value, string where)
        {
            var list = value as JArray;
            if (list == null || (list.Count != 4 && list.Count != 6))
                throw new CatalogException(where + ": span should be four or six whole numbers");
            var nums = new int[list.Count];
            for (int i = 0; i < list.Count; i++)
                nums[i] = CatalogInt(list[i], where, "span", 1);
            for (int i = 0; i < nums.Length; i += 2)
            {
                if (nums[i] > nums[i + 1])
                    throw new CatalogException(where + ": span should list each low before its high");
            }
            return nums;
        }

        static int[][] CatalogFits(JToken value, string where)
        {
            var list = value as JArray;
            if (list == null || list.Count == 0)
                throw new CatalogException(where + ": fits should list one or more sizes");
            var fits = new int[list.Count][];
            for (int i = 0; i < list.Count; i++)
                fits[i] = CatalogTriple(list[i], where, "fits");
            return fits;
        }

        static string CatalogNote(JObject row, string where)
        {
            JProperty prop = row.Property("note");
            if (prop == null || prop.Value.Type == JTokenType.Null || !JsonText.Truthy(prop.Value))
                return "";
            if (prop.Value.Type != JTokenType.String)
                throw new CatalogException(where + ": note should be text");
            return prop.Value.Value<string>();
        }
    }

    /// <summary>One singleblock machine. Its voltage is chosen when it is placed.</summary>
    internal sealed class Single
    {
        public string Name;
        public string Group;
        public bool Pollution;

        /// <summary>One singleblock machine from its row.</summary>
        public static Single Read(string code, JObject row, string where, string group)
        {
            return new Single
            {
                Name = Need(row, "name", where),
                Group = group,
                Pollution = Flag(row, where, "pollution"),
            };
        }

        /// <summary>What the editor reads about this machine.</summary>
        public JObject Editor()
        {
            return new JObject { ["name"] = Name, ["group"] = Group, ["pollution"] = Pollution };
        }

        static string Need(JObject row, string field, string where)
        {
            JProperty prop = row.Property(field);
            if (prop == null || prop.Value.Type != JTokenType.String || prop.Value.Value<string>().Trim().Length == 0)
                throw new CatalogException(where + ": " + field + " should be text");
            return prop.Value.Value<string>();
        }

        static bool Flag(JObject row, string where, string field)
        {
            JProperty prop = row.Property(field);
            if (prop == null)
                return false;
            if (prop.Value.Type != JTokenType.Boolean)
                throw new CatalogException(where + ": " + field + " should be true or false");
            return prop.Value.Value<bool>();
        }
    }

    /// <summary>A catalog JSON file cannot be loaded.</summary>
    internal sealed class CatalogException : Exception
    {
        public CatalogException(string message) : base(message)
        {
        }
    }

    /// <summary>Where catalog JSON is read from.</summary>
    interface IStore
    {
        string Read(string path);
        bool Exists(string path);
        IEnumerable<string> Files(string folder, string extension);
    }

    /// <summary>catalog/ in a source tree.</summary>
    sealed class DiskStore : IStore
    {
        readonly string root;

        public DiskStore(string root)
        {
            this.root = root;
        }

        public string Read(string path)
        {
            return File.ReadAllText(Disk(path), new UTF8Encoding(false));
        }

        public bool Exists(string path)
        {
            return File.Exists(Disk(path));
        }

        public IEnumerable<string> Files(string folder, string extension)
        {
            string dir = Disk(folder);
            if (!Directory.Exists(dir))
                yield break;
            foreach (string file in Directory.GetFiles(dir, "*" + extension))
                yield return folder.Replace('\\', '/').TrimEnd('/') + "/" + Path.GetFileName(file);
        }

        string Disk(string path)
        {
            return Path.Combine(root, path.Replace('/', '\\'));
        }
    }

    /// <summary>catalog/ packed inside the exe.</summary>
    sealed class PackedStore : IStore
    {
        public string Read(string path)
        {
            byte[] bytes = Bundle.Bytes(path);
            if (bytes == null)
                throw new CatalogException(path + " is missing");
            return new UTF8Encoding(false).GetString(bytes);
        }

        public bool Exists(string path)
        {
            return Bundle.Bytes(path) != null;
        }

        public IEnumerable<string> Files(string folder, string extension)
        {
            foreach (string name in Bundle.Names(folder))
            {
                if (name.EndsWith(extension, StringComparison.OrdinalIgnoreCase) && name.IndexOf('/', folder.Length + 1) < 0)
                    yield return name;
            }
        }
    }
}
