using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>Checks a plan the way layout.py does, before it is written.</summary>
    internal static class Layout
    {
        /// <summary>Every record of a plan. Throws when the plan cannot be used.</summary>
        public static void Check(string text, Catalog catalog)
        {
            new Checker(catalog).Run(text);
        }

        sealed class Checker
        {
            static readonly string[] Footprint = { "x0", "x1", "z0", "z1" };
            static readonly string[] Sides = { "n", "s", "e", "w" };
            static readonly string[] BaseStyles = { "rock", "corridor", "entry", "door", "trench", "stair", "well" };
            static readonly string[] Shapes = { "box", "circle", "well", "service", "text" };
            static readonly string[] Roofs = { "rock", "glass", "built" };
            static readonly string[] SheetKinds = { "overview", "detail", "terrain" };
            static readonly string[] TopLevel =
            {
                "site", "palette", "floors", "rooms", "streets", "doors", "stairs", "shafts", "lifts", "trenches",
                "pads", "walls", "marks", "callouts", "cuts", "sheets",
            };
            static readonly Dictionary<string, int[]> Dirs = new Dictionary<string, int[]>
            {
                { "n", new[] { 0, -1 } }, { "s", new[] { 0, 1 } }, { "e", new[] { 1, 0 } }, { "w", new[] { -1, 0 } },
            };

            const string CrawlId = "crawl";
            const string EmptySlot = "-";
            const int WorldBottom = 0;
            const int WorldTop = 255;

            readonly Catalog catalog;
            int[] square;
            int[] sheet;
            int[] inner;
            string[] columns;
            int terrainRows;
            List<Floor> floors;
            Dictionary<string, Floor> floorById;
            List<CrawlSpace> crawlSpaces = new List<CrawlSpace>();
            List<Room> rooms;
            List<Street> streets;
            List<Door> doors;
            List<Stair> stairs;
            List<Shaft> shafts;
            List<Lift> lifts;
            List<Item> trenches;
            List<Item> pads;
            List<Wall> walls;
            List<Item> marks;

            public Checker(Catalog catalog)
            {
                this.catalog = catalog;
            }

            /// <summary>Check one plan's text.</summary>
            public void Run(string text)
            {
                JObject data = ParseJson(text);
                Fields(data, "plan", TopLevel, null);
                ReadSite(data["site"] as JObject);
                ReadPalette(data["palette"] as JObject);
                ReadFloors(data["floors"] as JArray);
                ReadCrawls(data["site"] as JObject);
                rooms = ReadRooms(data["rooms"] as JArray);
                var roomById = new Dictionary<string, Room>(StringComparer.Ordinal);
                foreach (Room room in rooms)
                    roomById[room.Id] = room;
                streets = ReadStreets(data["streets"] as JArray);
                doors = ReadDoors(data["doors"] as JArray);
                stairs = ReadStairs(data["stairs"] as JArray);
                shafts = ReadShafts(data["shafts"] as JArray, roomById);
                lifts = ReadLifts(data["lifts"] as JArray);
                trenches = ReadTrenches(data["trenches"] as JArray);
                pads = ReadPads(data["pads"] as JArray, roomById);
                walls = ReadWalls(data["walls"] as JArray, roomById);
                marks = ReadMarks(data["marks"] as JArray, roomById);
                ReadSheets(data["sheets"] as JArray);
                ReadCallouts(data["callouts"] as JArray);
                ReadCuts(data["cuts"] as JArray);
                CheckFootprints();
            }

            /// <summary>The plan's text as parsed JSON.</summary>
            static JObject ParseJson(string text)
            {
                try
                {
                    var data = JToken.Parse(text) as JObject;
                    if (data == null)
                        throw new LayoutException("plan should be an object");
                    return data;
                }
                catch (JsonReaderException ex)
                {
                    throw new LayoutException("The plan is not valid JSON: line " + ex.LineNumber + ", column " + ex.LinePosition + ": " + ex.Message);
                }
            }

            /// <summary>The working square, the sheet's edges, the chunk grid, and the ground estimate.</summary>
            void ReadSite(JObject site)
            {
                Fields(site, "site", new[] { "square", "sheet", "rim", "columns", "dirty", "cover", "terrain" }, new[] { "tier", "name", "crawl", "crawls" });
                if (Has(site, "tier"))
                    Choice(site["tier"], "site", "tier", Catalog.Voltage);
                if (Has(site, "name"))
                    Str(site["name"], "site", "name", false);
                Fields(site["square"] as JObject, "site.square", Footprint, null);
                Fields(site["sheet"] as JObject, "site.sheet", Footprint, null);
                square = BoxOf(site["square"] as JObject, "site.square");
                sheet = BoxOf(site["sheet"] as JObject, "site.sheet");
                int rim = Int(site["rim"], "site", "rim", 0);
                columns = ReadColumns(site["columns"]);
                terrainRows = TerrainRows(site["terrain"] as JArray);
                Dirty(site["dirty"] as JArray);
                Int(site["cover"], "site", "cover", 0);
                inner = new[] { square[0] + rim, square[1] - rim, square[2] + rim, square[3] - rim };
            }

            /// <summary>The ground estimate: one row per chunk row, one Y per chunk column.</summary>
            int TerrainRows(JArray terrain)
            {
                if (terrain == null || terrain.Count == 0)
                    throw new LayoutException("site.terrain should be a list of rows");
                for (int r = 0; r < terrain.Count; r++)
                {
                    var row = terrain[r] as JArray;
                    if (row == null || row.Count != columns.Length)
                        throw new LayoutException("site.terrain row " + (r + 1) + " should have " + columns.Length + " numbers, one per chunk column");
                    foreach (JToken value in row)
                        Int(value, "site.terrain row " + (r + 1), "ground Y", null);
                }
                return terrain.Count;
            }

            /// <summary>The chunks that may hold polluting machines.</summary>
            void Dirty(JArray names)
            {
                if (names == null)
                    throw new LayoutException("site.dirty: None is not a chunk like E6");
                foreach (JToken name in names)
                {
                    if (!IsChunk(name))
                        throw new LayoutException("site.dirty: " + JsonText.Repr(name) + " is not a chunk like E6");
                }
            }

            /// <summary>The chunk column names. A string is one letter each; a list names them, such as AA.</summary>
            static string[] ReadColumns(JToken value)
            {
                if (value != null && value.Type == JTokenType.String && value.Value<string>().Length > 0)
                {
                    string text = value.Value<string>();
                    var names = new string[text.Length];
                    for (int i = 0; i < text.Length; i++)
                        names[i] = text[i].ToString();
                    return names;
                }
                var list = value as JArray;
                if (list == null || list.Count == 0)
                    throw new LayoutException("site: columns should name the chunk columns");
                var fromList = new string[list.Count];
                for (int i = 0; i < list.Count; i++)
                {
                    if (list[i] == null || list[i].Type != JTokenType.String || list[i].Value<string>().Length == 0)
                        throw new LayoutException("site: columns should name the chunk columns");
                    fromList[i] = list[i].Value<string>();
                }
                return fromList;
            }

            /// <summary>The letters and row of a chunk name such as E6 or AA12.</summary>
            static bool SplitChunk(string text, out string letters, out int row)
            {
                letters = "";
                row = 0;
                int split = 0;
                while (split < text.Length && text[split] >= 'A' && text[split] <= 'Z')
                    split++;
                if (split == 0 || split == text.Length)
                    return false;
                for (int i = split; i < text.Length; i++)
                {
                    if (text[i] < '0' || text[i] > '9')
                        return false;
                }
                letters = text.Substring(0, split);
                return int.TryParse(text.Substring(split), NumberStyles.None, CultureInfo.InvariantCulture, out row);
            }

            /// <summary>Whether a name is a column and a row number that are both on the chunk grid.</summary>
            bool IsChunk(JToken name)
            {
                if (name == null || name.Type != JTokenType.String)
                    return false;
                string letters;
                int row;
                if (!SplitChunk(name.Value<string>(), out letters, out row))
                    return false;
                return Array.IndexOf(columns, letters) >= 0 && row >= 1 && row <= terrainRows;
            }

            /// <summary>The fill of each kind of dug cell, and the color of each machine group.</summary>
            void ReadPalette(JObject palette)
            {
                var required = new List<string>(BaseStyles);
                required.Add("groups");
                Fields(palette, "palette", required, null);
                foreach (string key in BaseStyles)
                    Hex(palette[key], "palette", key);
                var groups = palette["groups"] as JObject;
                Fields(groups, "palette.groups", catalog.GroupOrder, null);
                foreach (string key in catalog.GroupOrder)
                    Hex(groups[key], "palette.groups", key);
            }

            /// <summary>The floors, lowest first.</summary>
            void ReadFloors(JArray rows)
            {
                floors = new List<Floor>();
                int index = 0;
                foreach (JToken token in Each(rows, "floors"))
                {
                    floors.Add(ReadFloor(token as JObject, NameOf("floors", index, token)));
                    index++;
                }
                if (floors.Count == 0)
                    throw new LayoutException("floors: there should be at least one floor");
                Unique(floors, "floors", "id", floor => floor.Id);
                floors.Sort((a, b) => a.Slab.CompareTo(b.Slab));
                floorById = new Dictionary<string, Floor>(StringComparer.Ordinal);
                foreach (Floor floor in floors)
                {
                    if (floor.Id == CrawlId)
                        throw new LayoutException("floors: 'crawl' is the pipe crawl's name; give the floor another id");
                    floorById[floor.Id] = floor;
                }
            }

            /// <summary>One floor.</summary>
            Floor ReadFloor(JObject row, string where)
            {
                var optional = new List<string> { "height", "pen" };
                optional.AddRange(Footprint);
                Fields(row, where, new[] { "id", "name", "slab" }, optional);
                int? x0;
                int? x1;
                int? z0;
                int? z1;
                OwnSpan(row, where, out x0, out x1, out z0, out z1);
                return new Floor
                {
                    Id = Ident(row["id"], where, "id"),
                    Name = Str(row["name"], where, "name", false),
                    Slab = Int(row["slab"], where, "slab", null),
                    Height = Int(Pick(row, "height", 5), where, "height", 1),
                    Pen = Hex(Pick(row, "pen", "#282C32"), where, "pen"),
                    X0 = x0, X1 = x1, Z0 = z0, Z1 = z1,
                };
            }

            /// <summary>A floor's own footprint, or four nulls when the plan leaves it out.</summary>
            void OwnSpan(JObject row, string where, out int? x0, out int? x1, out int? z0, out int? z1)
            {
                int given = 0;
                foreach (string key in Footprint)
                {
                    if (Has(row, key))
                        given++;
                }
                x0 = x1 = z0 = z1 = null;
                if (given == 0)
                    return;
                if (given != 4)
                    throw new LayoutException(where + ": a footprint needs x0, x1, z0, and z1 together");
                int[] box = BoxOf(row, where);
                x0 = box[0];
                x1 = box[1];
                z0 = box[2];
                z1 = box[3];
            }

            /// <summary>Every crawlspace. site.crawl is one; site.crawls is a list. A plan has one of those, or neither.</summary>
            void ReadCrawls(JObject site)
            {
                bool one = Has(site, "crawl");
                bool many = Has(site, "crawls");
                if (one && many)
                    throw new LayoutException("site: a plan has crawl or crawls, not both");
                var rows = new List<JObject>();
                var wheres = new List<string>();
                if (many)
                {
                    JArray list = site["crawls"] as JArray;
                    if (list == null)
                        throw new LayoutException("site.crawls should be a list");
                    int index = 0;
                    foreach (JToken token in list)
                    {
                        rows.Add(token as JObject);
                        wheres.Add("site.crawls." + index);
                        index++;
                    }
                }
                else if (one)
                {
                    rows.Add(site["crawl"] as JObject);
                    wheres.Add("site.crawl");
                }
                var used = new HashSet<string>(StringComparer.Ordinal);
                for (int i = 0; i < rows.Count; i++)
                    ReadOneCrawl(rows[i], wheres[i], used);
                CheckAir();
            }

            /// <summary>One crawlspace: the floor it hangs under, and its band of air.</summary>
            void ReadOneCrawl(JObject crawl, string where, HashSet<string> used)
            {
                Fields(crawl, where, new[] { "name", "under", "below", "height" }, new[] { "id" });
                Floor under = RefFloor(crawl["under"], where, "under");
                int top = under.Slab - Int(crawl["below"], where, "below", 1);
                int low = top - Int(crawl["height"], where, "height", 2) + 1;
                string id;
                if (Has(crawl, "id"))
                    id = Ident(crawl["id"], where, "id");
                else if (used.Count == 0)
                    id = CrawlId;
                else
                {
                    int number = 2;
                    while (used.Contains(CrawlId + "-" + number))
                        number++;
                    id = CrawlId + "-" + number;
                }
                if (!used.Add(id))
                    throw new LayoutException(where + ": id " + JsonText.Quote(id) + " is already a crawlspace");
                crawlSpaces.Add(new CrawlSpace { Id = id, Name = Str(crawl["name"], where, "name", false), Under = under.Id, Low = low, High = top });
            }

            /// <summary>Whether a sheet or a trench names this crawlspace.</summary>
            bool IsCrawlId(string id)
            {
                if (string.IsNullOrEmpty(id))
                    return false;
                foreach (CrawlSpace crawl in crawlSpaces)
                {
                    if (crawl.Id == id)
                        return true;
                }
                return false;
            }

            /// <summary>The crawlspace a trench is dug in, or null.</summary>
            CrawlSpace TrenchOwner(Item trench)
            {
                if (!string.IsNullOrEmpty(trench.Crawl))
                {
                    foreach (CrawlSpace crawl in crawlSpaces)
                    {
                        if (crawl.Id == trench.Crawl)
                            return crawl;
                    }
                    return null;
                }
                if (crawlSpaces.Count == 1)
                    return crawlSpaces[0];
                foreach (CrawlSpace crawl in crawlSpaces)
                {
                    if (crawl.Id == CrawlId)
                        return crawl;
                }
                return null;
            }

            /// <summary>Every band of air stays inside the world.</summary>
            void CheckAir()
            {
                foreach (Floor floor in floors)
                {
                    if (floor.AirLow < WorldBottom || floor.AirHigh > WorldTop)
                        throw new LayoutException(floor.Name + ": air stays inside Y 0 through 255");
                }
                foreach (CrawlSpace crawl in crawlSpaces)
                {
                    if (crawl.Low < WorldBottom || crawl.High > WorldTop)
                        throw new LayoutException("site.crawl: air stays inside Y 0 through 255");
                }
            }

            /// <summary>The rooms.</summary>
            List<Room> ReadRooms(JArray rows)
            {
                var list = new List<Room>();
                int index = 0;
                foreach (JToken token in Each(rows, "rooms"))
                {
                    list.Add(ReadRoom(token as JObject, NameOf("rooms", index, token)));
                    index++;
                }
                Unique(list, "rooms", "id", room => room.Id);
                var styles = new HashSet<string>(BaseStyles, StringComparer.Ordinal);
                var clash = new List<string>();
                foreach (Room room in list)
                {
                    if (styles.Contains(room.Id))
                        clash.Add(room.Id);
                }
                if (clash.Count > 0)
                {
                    clash.Sort(StringComparer.Ordinal);
                    throw new LayoutException("rooms: " + JsonText.Quote(clash[0]) + " is a reserved name; give the room another id");
                }
                return list;
            }

            /// <summary>One room. Its air starts at its floor's and runs as high as the room asks.</summary>
            Room ReadRoom(JObject row, string where)
            {
                Fields(row, where, new[] { "id", "floor", "name", "code", "color", "x0", "x1", "z0", "z1" },
                    new[] { "height", "label_at", "clean", "grade", "roof", "locked" });
                Floor floor = RefFloor(row["floor"], where, "floor");
                int[] box = BoxOf(row, where);
                int height = Int(Pick(row, "height", floor.Height), where, "height", 2);
                if (Has(row, "locked"))
                    Bool(row["locked"], where, "locked");
                int labelX = Has(row, "label_at") ? Point(row["label_at"], where, "label_at")[0] : Half(box[0], box[1]);
                int labelZ = Has(row, "label_at") ? Point(row["label_at"], where, "label_at")[1] : Half(box[2], box[3]);
                return new Room
                {
                    Id = Ident(row["id"], where, "id"),
                    Floor = floor.Id,
                    Name = Str(row["name"], where, "name", false),
                    Box = box,
                    Y1 = floor.AirLow + height - 1,
                    LabelX = labelX,
                    LabelZ = labelZ,
                };
            }

            /// <summary>The streets, the entrance among them.</summary>
            List<Street> ReadStreets(JArray rows)
            {
                var list = new List<Street>();
                int index = 0;
                foreach (JToken token in Each(rows, "streets"))
                {
                    list.Add(ReadStreet(token as JObject, NameOf("streets", index, token)));
                    index++;
                }
                Unique(list, "streets", "id", street => street.Id);
                return list;
            }

            /// <summary>One street.</summary>
            Street ReadStreet(JObject row, string where)
            {
                Fields(row, where, new[] { "id", "floor", "x0", "x1", "z0", "z1" },
                    new[] { "style", "trench", "carve", "label", "label_at", "label_vertical" });
                Floor floor = RefFloor(row["floor"], where, "floor");
                if (Has(row, "label_at"))
                    Point(row["label_at"], where, "label_at");
                Flag(row, where, "trench", true);
                Flag(row, where, "label_vertical", false);
                Str(Pick(row, "label", ""), where, "label", true);
                return new Street
                {
                    Id = Ident(row["id"], where, "id"),
                    Floor = floor.Id,
                    Box = BoxOf(row, where),
                    Style = Choice(Pick(row, "style", "corridor"), where, "style", new[] { "corridor", "entry" }),
                    Label = Str(Pick(row, "label", ""), where, "label", true),
                };
            }

            /// <summary>The doors.</summary>
            List<Door> ReadDoors(JArray rows)
            {
                var list = new List<Door>();
                int index = 0;
                foreach (JToken token in Each(rows, "doors"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("doors", index, token);
                    Fields(row, where, new[] { "id", "floor", "x0", "x1", "z0", "z1" }, null);
                    RefFloor(row["floor"], where, "floor");
                    list.Add(new Door { Id = Ident(row["id"], where, "id"), Floor = row["floor"].Value<string>(), Box = BoxOf(row, where) });
                    index++;
                }
                Unique(list, "doors", "id", door => door.Id);
                return list;
            }

            /// <summary>The stairs.</summary>
            List<Stair> ReadStairs(JArray rows)
            {
                var list = new List<Stair>();
                int index = 0;
                foreach (JToken token in Each(rows, "stairs"))
                {
                    list.Add(ReadStair(token as JObject, NameOf("stairs", index, token)));
                    index++;
                }
                Unique(list, "stairs", "id", stair => stair.Id);
                return list;
            }

            /// <summary>One stair, open from the bottom floor's air to the top floor's ceiling.</summary>
            Stair ReadStair(JObject row, string where)
            {
                Fields(row, where, new[] { "id", "floors", "low", "x0", "x1", "z0", "z1" }, null);
                var pair = row["floors"] as JArray;
                if (pair == null || pair.Count != 2)
                    throw new LayoutException(where + ": floors should be [bottom floor, top floor]");
                Floor bottom = RefFloor(pair[0], where, "floors");
                Floor top = RefFloor(pair[1], where, "floors");
                if (bottom.Slab >= top.Slab)
                    throw new LayoutException(where + ": floors should list the bottom floor first");
                return new Stair
                {
                    Id = Ident(row["id"], where, "id"),
                    Box = BoxOf(row, where),
                    Low = Choice(row["low"], where, "low", Sides),
                    Floors = new[] { bottom.Id, top.Id },
                };
            }

            /// <summary>The shafts to the sky.</summary>
            List<Shaft> ReadShafts(JArray rows, Dictionary<string, Room> roomById)
            {
                var list = new List<Shaft>();
                int index = 0;
                foreach (JToken token in Each(rows, "shafts"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("shafts", index, token);
                    Fields(row, where, new[] { "id", "room", "x0", "x1", "z0", "z1" }, new[] { "label", "cap" });
                    Room room = RefRoom(row["room"], roomById, where, "room");
                    Str(Pick(row, "label", ""), where, "label", true);
                    Choice(Pick(row, "cap", ""), where, "cap", new[] { "", "glass" });
                    list.Add(new Shaft
                    {
                        Id = Ident(row["id"], where, "id"),
                        Floor = room.Floor,
                        Box = BoxOf(row, where),
                        Label = Str(Pick(row, "label", ""), where, "label", true),
                    });
                    index++;
                }
                Unique(list, "shafts", "id", shaft => shaft.Id);
                return list;
            }

            /// <summary>The lifts.</summary>
            List<Lift> ReadLifts(JArray rows)
            {
                var list = new List<Lift>();
                int index = 0;
                foreach (JToken token in Each(rows, "lifts"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("lifts", index, token);
                    Fields(row, where, new[] { "id", "x", "z", "floors" }, new[] { "label" });
                    var stops = row["floors"] as JArray;
                    if (stops == null)
                        throw new LayoutException(where + ": floors should list two or more floors, bottom to top");
                    var ids = new List<string>();
                    var slabs = new List<int>();
                    foreach (JToken stop in stops)
                    {
                        Floor floor = RefFloor(stop, where, "floors");
                        ids.Add(floor.Id);
                        slabs.Add(floor.Slab);
                    }
                    var ordered = new List<int>(slabs);
                    ordered.Sort();
                    bool rising = slabs.Count >= 2;
                    for (int i = 0; rising && i < slabs.Count; i++)
                        rising = slabs[i] == ordered[i];
                    if (!rising)
                        throw new LayoutException(where + ": floors should list two or more floors, bottom to top");
                    Str(Pick(row, "label", ""), where, "label", true);
                    int x = Int(row["x"], where, "x", null);
                    int z = Int(row["z"], where, "z", null);
                    list.Add(new Lift
                    {
                        Id = Ident(row["id"], where, "id"),
                        Box = new[] { x, x, z, z },
                        Floors = ids.ToArray(),
                        Label = Str(Pick(row, "label", ""), where, "label", true),
                    });
                    index++;
                }
                Unique(list, "lifts", "id", lift => lift.Id);
                return list;
            }

            /// <summary>The runs of the pipe crawl.</summary>
            List<Item> ReadTrenches(JArray rows)
            {
                var list = new List<Item>();
                var ids = new List<string>();
                int index = 0;
                foreach (JToken token in Each(rows, "trenches"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("trenches", index, token);
                    Fields(row, where, new[] { "id", "x0", "x1", "z0", "z1" }, new[] { "crawl" });
                    ids.Add(Ident(row["id"], where, "id"));
                    string crawlId = "";
                    if (Has(row, "crawl"))
                    {
                        crawlId = Ident(row["crawl"], where, "crawl");
                        if (!IsCrawlId(crawlId))
                            throw new LayoutException(where + ": " + crawlId + " is not a crawlspace");
                    }
                    int[] box = BoxOf(row, where);
                    list.Add(new Item { Id = ids[ids.Count - 1], Box = box, Crawl = crawlId });
                    index++;
                }
                Unique(list, "trenches", "id", trench => trench.Id);
                return list;
            }

            /// <summary>The multiblocks.</summary>
            List<Item> ReadPads(JArray rows, Dictionary<string, Room> roomById)
            {
                var list = new List<Item>();
                int index = 0;
                foreach (JToken token in Each(rows, "pads"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("pads", index, token);
                    Fields(row, where, new[] { "num", "key", "room", "x0", "x1", "z0", "z1", "front" },
                        new[] { "h", "share", "door", "label", "wx", "wz", "flip" });
                    RefRoom(row["room"], roomById, where, "room");
                    RefKey(row["key"], catalog.Multis, where, "key");
                    Choice(row["front"], where, "front", Sides);
                    Int(Pick(row, "h", 0), where, "h", 0);
                    Flag(row, where, "share", false);
                    Int(Pick(row, "wx", 1), where, "wx", 1);
                    Int(Pick(row, "wz", 1), where, "wz", 1);
                    if (Has(row, "flip") && JsonText.Truthy(row["flip"]))
                        Choice(row["flip"], where, "flip", new[] { "x", "z" });
                    if (Has(row, "door"))
                        Point(row["door"], where, "door");
                    Str(Pick(row, "label", ""), where, "label", true);
                    int num = Int(row["num"], where, "num", 1);
                    list.Add(new Item
                    {
                        Num = num,
                        Key = row["key"].Type == JTokenType.String ? row["key"].Value<string>() : "",
                        Label = Str(Pick(row, "label", ""), where, "label", true),
                        Room = row["room"].Value<string>(),
                        Box = BoxOf(row, where),
                    });
                    index++;
                }
                UniqueNum(list, "pads");
                return list;
            }

            /// <summary>The machine rows.</summary>
            List<Wall> ReadWalls(JArray rows, Dictionary<string, Room> roomById)
            {
                var list = new List<Wall>();
                int index = 0;
                foreach (JToken token in Each(rows, "walls"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("walls", index, token);
                    Fields(row, where, new[] { "id", "room", "x", "z", "along", "face", "codes" }, new[] { "title", "tiers" });
                    RefRoom(row["room"], roomById, where, "room");
                    string[] codes = Codes(row["codes"], where);
                    if (Has(row, "tiers"))
                        Tiers(row["tiers"], codes, where);
                    string along = Choice(row["along"], where, "along", Sides);
                    Choice(row["face"], where, "face", Sides);
                    Str(Pick(row, "title", ""), where, "title", true);
                    int x = Int(row["x"], where, "x", null);
                    int z = Int(row["z"], where, "z", null);
                    list.Add(new Wall
                    {
                        Id = Str(row["id"], where, "id", false),
                        Room = row["room"].Value<string>(),
                        Title = Str(Pick(row, "title", ""), where, "title", true),
                        Box = WallBox(x, z, along, codes.Length),
                    });
                    index++;
                }
                Unique(list, "walls", "id", wall => wall.Id);
                return list;
            }

            /// <summary>One machine code per slot. An empty slot reads as blank.</summary>
            string[] Codes(JToken text, string where)
            {
                string[] parts = Str(text, where, "codes", false).Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                foreach (string code in parts)
                {
                    if (code != EmptySlot)
                        RefKey(new JValue(code), catalog.Singles, where, "codes");
                }
                return parts;
            }

            /// <summary>One voltage per slot. A row that is MV throughout keeps none.</summary>
            void Tiers(JToken text, string[] codes, string where)
            {
                string[] parts = Str(text, where, "tiers", false).Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length != codes.Length)
                    throw new LayoutException(where + ": tiers should have one entry per slot");
                for (int i = 0; i < parts.Length; i++)
                {
                    if (codes[i] != EmptySlot)
                        Choice(new JValue(parts[i]), where, "tiers", catalog.Slot());
                    else if (parts[i] != EmptySlot)
                        throw new LayoutException(where + ": an empty slot's tier is '-'");
                }
            }

            /// <summary>The cells a machine row covers.</summary>
            static int[] WallBox(int x, int z, string along, int count)
            {
                int[] step = Dirs[along];
                int last = Math.Max(1, count) - 1;
                int xe = x + step[0] * last;
                int ze = z + step[1] * last;
                return new[] { Math.Min(x, xe), Math.Max(x, xe), Math.Min(z, ze), Math.Max(z, ze) };
            }

            /// <summary>The floor marks.</summary>
            List<Item> ReadMarks(JArray rows, Dictionary<string, Room> roomById)
            {
                var list = new List<Item>();
                int index = 0;
                foreach (JToken token in Each(rows, "marks"))
                {
                    JObject row = token as JObject;
                    string where = "marks[" + index + "]";
                    Fields(row, where, new[] { "room", "label", "x0", "x1", "z0", "z1" },
                        new[] { "short", "shape", "radius", "vertical", "detail" });
                    Room room = RefRoom(row["room"], roomById, where, "room");
                    Str(row["label"], where, "label", true);
                    Str(Pick(row, "short", ""), where, "short", true);
                    Choice(Pick(row, "shape", "box"), where, "shape", Shapes);
                    Int(Pick(row, "radius", 0), where, "radius", 0);
                    Flag(row, where, "vertical", false);
                    Flag(row, where, "detail", false);
                    string label = Str(row["label"], where, "label", true);
                    string brief = Str(Pick(row, "short", ""), where, "short", true);
                    list.Add(new Item
                    {
                        Room = room.Id,
                        Label = brief.Length > 0 ? brief : (label.Length > 0 ? label : "area"),
                        Box = BoxOf(row, where),
                    });
                    index++;
                }
                return list;
            }

            /// <summary>The sheets.</summary>
            void ReadSheets(JArray rows)
            {
                var ids = new List<string>();
                int index = 0;
                foreach (JToken token in Each(rows, "sheets"))
                {
                    JObject row = token as JObject;
                    string where = NameOf("sheets", index, token);
                    Fields(row, where, new[] { "id", "kind", "title", "blurb" },
                        new[] { "floor", "region", "scale", "cuts", "profiles", "notes" });
                    string kind = Choice(row["kind"], where, "kind", SheetKinds);
                    string floor = Has(row, "floor") && row["floor"].Type == JTokenType.String ? row["floor"].Value<string>() : null;
                    if (kind != "terrain" && !IsCrawlId(floor))
                        RefFloor(row["floor"], where, "floor");
                    if (kind == "detail")
                    {
                        var region = row["region"] as JArray;
                        if (region == null || region.Count != 4)
                            throw new LayoutException(where + ": region should be [x0, x1, z0, z1]");
                        Int(row["scale"], where, "scale", 2);
                    }
                    ids.Add(Ident(row["id"], where, "id"));
                    index++;
                }
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (string id in ids)
                {
                    if (!seen.Add(id))
                        throw new LayoutException("sheets: id " + JsonText.Quote(id) + " is used twice");
                }
            }

            /// <summary>The boxed notes drawn over a sheet.</summary>
            void ReadCallouts(JArray rows)
            {
                int index = 0;
                foreach (JToken token in Each(rows, "callouts"))
                {
                    JObject row = token as JObject;
                    string where = "callouts[" + index + "]";
                    Fields(row, where, new[] { "title", "body", "x0", "x1", "z0", "z1", "sheets" }, null);
                    BoxOf(row, where);
                    if (!(row["sheets"] is JArray))
                        throw new LayoutException(where + ": sheets should be a list");
                    index++;
                }
            }

            /// <summary>The section cuts.</summary>
            void ReadCuts(JArray rows)
            {
                int index = 0;
                foreach (JToken token in Each(rows, "cuts"))
                {
                    JObject row = token as JObject;
                    string where = "cuts[" + index + "]";
                    Fields(row, where, new[] { "name", "axis", "at", "caption" }, null);
                    Str(row["name"], where, "name", false);
                    Choice(row["axis"], where, "axis", new[] { "x", "z" });
                    Int(row["at"], where, "at", null);
                    Str(row["caption"], where, "caption", false);
                    index++;
                }
            }

            /// <summary>A floor's footprint stays inside the main plan, and everything on it stays inside the footprint.</summary>
            void CheckFootprints()
            {
                foreach (Floor floor in floors)
                {
                    CheckFloorSpan(floor);
                    int[] box = FloorBox(floor);
                    foreach (Zone zone in Zones(floor, box))
                    {
                        if (!Contains(zone.Box, zone.Limit))
                            throw new LayoutException(zone.Label + " sits outside " + floor.Name);
                    }
                }
            }

            /// <summary>A floor's own footprint stays inside the site, or inside the main floor.</summary>
            void CheckFloorSpan(Floor floor)
            {
                if (floor.Span == null || Contains(floor.Span, FloorLimit(floor)))
                    return;
                Floor main = MainFloor();
                if (floor.Id == main.Id)
                    throw new LayoutException(floor.Name + " stays inside the site");
                throw new LayoutException(floor.Name + " stays inside " + main.Name);
            }

            /// <summary>The footprint a floor draws in.</summary>
            int[] FloorBox(Floor floor)
            {
                if (floor.Span != null)
                    return floor.Span;
                Floor main = MainFloor();
                if (floor.Id != main.Id && main.Span != null)
                    return main.Span;
                return inner;
            }

            /// <summary>The largest footprint a floor may have.</summary>
            int[] FloorLimit(Floor floor)
            {
                Floor main = MainFloor();
                return floor.Id == main.Id ? inner : FloorBox(main);
            }

            /// <summary>The floor the others fit inside: the one with id main, or the lowest.</summary>
            Floor MainFloor()
            {
                foreach (Floor floor in floors)
                {
                    if (floor.Id == "main")
                        return floor;
                }
                Floor best = floors[0];
                foreach (Floor floor in floors)
                {
                    if (floor.Slab < best.Slab || (floor.Slab == best.Slab && string.CompareOrdinal(floor.Id, best.Id) < 0))
                        best = floor;
                }
                return best;
            }

            /// <summary>Each dug zone and everything standing in a floor's rooms.</summary>
            IEnumerable<Zone> Zones(Floor floor, int[] box)
            {
                foreach (Room room in rooms)
                {
                    if (room.Floor == floor.Id)
                        yield return new Zone(room.Name, room.Box, box);
                }
                foreach (Street street in streets)
                {
                    if (street.Floor == floor.Id)
                        yield return new Zone(street.Label.Length > 0 ? street.Label : street.Id, street.Box, StreetLimit(street, box));
                }
                foreach (Door door in doors)
                {
                    if (door.Floor == floor.Id)
                        yield return new Zone(door.Id, door.Box, box);
                }
                foreach (Shaft shaft in shafts)
                {
                    if (shaft.Floor == floor.Id)
                        yield return new Zone(shaft.Label.Length > 0 ? shaft.Label : shaft.Id, shaft.Box, box);
                }
                foreach (Stair stair in stairs)
                {
                    if (Array.IndexOf(stair.Floors, floor.Id) >= 0)
                        yield return new Zone(stair.Id, stair.Box, box);
                }
                foreach (Lift lift in lifts)
                {
                    if (Array.IndexOf(lift.Floors, floor.Id) >= 0)
                        yield return new Zone(lift.Label.Length > 0 ? lift.Label : lift.Id, lift.Box, box);
                }
                foreach (CrawlSpace crawl in crawlSpaces)
                {
                    if (crawl.Under != floor.Id)
                        continue;
                    foreach (Item trench in trenches)
                    {
                        CrawlSpace owner = TrenchOwner(trench);
                        if (owner == crawl)
                            yield return new Zone(trench.Id, trench.Box, box);
                    }
                }
                var roomFloor = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (Room room in rooms)
                    roomFloor[room.Id] = room.Floor;
                foreach (Item pad in pads)
                {
                    string home;
                    if (roomFloor.TryGetValue(pad.Room, out home) && home == floor.Id)
                        yield return new Zone(pad.Label.Length > 0 ? pad.Label : pad.Key, pad.Box, box);
                }
                foreach (Wall wall in walls)
                {
                    string home;
                    if (roomFloor.TryGetValue(wall.Room, out home) && home == floor.Id)
                        yield return new Zone(wall.Title.Length > 0 ? wall.Title : wall.Id, wall.Box, box);
                }
                foreach (Item mark in marks)
                {
                    string home;
                    if (roomFloor.TryGetValue(mark.Room, out home) && home == floor.Id)
                        yield return new Zone(mark.Label, mark.Box, box);
                }
            }

            /// <summary>How far north a street may run. An entrance may sit north of the rim. A street in line with one may cross the rim.</summary>
            int[] StreetLimit(Street street, int[] box)
            {
                if (box[2] > inner[2])
                    return box;
                if (street.Style == "entry")
                    return new[] { box[0], box[1], sheet[2], box[3] };
                foreach (Street other in streets)
                {
                    if (other.Style == "entry" && street.Floor == other.Floor && street.Box[0] >= other.Box[0] && street.Box[1] <= other.Box[1])
                        return new[] { box[0], box[1], square[2], box[3] };
                }
                return box;
            }

            /// <summary>Whether a footprint lies inside a limit.</summary>
            static bool Contains(int[] box, int[] limit)
            {
                return box[0] >= limit[0] && box[1] <= limit[1] && box[2] >= limit[2] && box[3] <= limit[3];
            }

            /// <summary>Each record of a list. A missing list is a plan error.</summary>
            static IEnumerable<JToken> Each(JArray rows, string kind)
            {
                if (rows == null)
                    throw new LayoutException(kind + " should be a list");
                return rows;
            }

            /// <summary>The label a record's messages carry.</summary>
            static string NameOf(string kind, int index, JToken row)
            {
                string label = kind + "[" + index + "]";
                var obj = row as JObject;
                if (obj == null)
                    return label;
                JToken rid = obj.Property("id") != null ? obj["id"] : (obj.Property("num") != null ? obj["num"] : null);
                if (rid == null || rid.Type == JTokenType.Null)
                    return label;
                return label + " " + JsonText.Repr(rid);
            }

            /// <summary>No two records of a list share an id.</summary>
            static void Unique<T>(List<T> items, string kind, string key, Func<T, string> value)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (T item in items)
                {
                    string id = value(item);
                    if (!seen.Add(id))
                        throw new LayoutException(kind + ": " + key + " " + JsonText.Quote(id) + " is used twice");
                }
            }

            /// <summary>No two multiblocks share a number.</summary>
            static void UniqueNum(List<Item> items, string kind)
            {
                var seen = new HashSet<int>();
                foreach (Item item in items)
                {
                    if (!seen.Add(item.Num))
                        throw new LayoutException(kind + ": num " + item.Num.ToString(CultureInfo.InvariantCulture) + " is used twice");
                }
            }

            /// <summary>A record has every required field and none the loader does not know.</summary>
            static void Fields(JObject row, string where, IEnumerable<string> required, IEnumerable<string> optional)
            {
                if (row == null)
                    throw new LayoutException(where + " should be an object");
                var known = new HashSet<string>(required, StringComparer.Ordinal);
                if (optional != null)
                {
                    foreach (string key in optional)
                        known.Add(key);
                }
                foreach (JProperty prop in row.Properties())
                {
                    if (!known.Contains(prop.Name))
                        throw new LayoutException(where + ": unknown field " + JsonText.Quote(prop.Name));
                }
                foreach (string key in required)
                {
                    if (row.Property(key) == null)
                        throw new LayoutException(where + ": missing " + JsonText.Quote(key));
                }
            }

            /// <summary>The record a field points at.</summary>
            Floor RefFloor(JToken value, string where, string key)
            {
                string id = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                Floor floor;
                if (id != null && floorById.TryGetValue(id, out floor))
                    return floor;
                throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " is not one of " + Known(floorById.Keys));
            }

            /// <summary>The room a field points at.</summary>
            static Room RefRoom(JToken value, Dictionary<string, Room> table, string where, string key)
            {
                string id = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                Room room;
                if (id != null && table.TryGetValue(id, out room))
                    return room;
                throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " is not one of " + Known(table.Keys));
            }

            /// <summary>A catalog key a field points at.</summary>
            static void RefKey<T>(JToken value, Dictionary<string, T> table, string where, string key)
            {
                string id = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                if (id != null && table.ContainsKey(id))
                    return;
                throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " is not one of " + Known(table.Keys));
            }

            /// <summary>The ids a message lists, or a count when there are many.</summary>
            static string Known(ICollection<string> keys)
            {
                if (keys.Count >= 12)
                    return keys.Count + " known ids";
                var names = new List<string>(keys);
                names.Sort(StringComparer.Ordinal);
                return string.Join(", ", names);
            }

            /// <summary>A whole number, and at least low when one is given.</summary>
            static int Int(JToken value, string where, string key, int? low)
            {
                if (value == null || value.Type == JTokenType.Boolean || value.Type != JTokenType.Integer)
                    throw new LayoutException(where + ": " + key + " should be a whole number, not " + JsonText.Repr(value));
                long number = value.Value<long>();
                if (number < int.MinValue || number > int.MaxValue)
                    throw new LayoutException(where + ": " + key + " should be a whole number, not " + JsonText.Repr(value));
                int whole = (int)number;
                if (low != null && whole < low.Value)
                    throw new LayoutException(where + ": " + key + " should be at least " + low.Value.ToString(CultureInfo.InvariantCulture));
                return whole;
            }

            /// <summary>Text. It may be blank only when empty says so.</summary>
            static string Str(JToken value, string where, string key, bool empty)
            {
                if (value == null || value.Type != JTokenType.String || (!empty && value.Value<string>().Trim().Length == 0))
                    throw new LayoutException(where + ": " + key + " should be text");
                return value.Value<string>();
            }

            /// <summary>True or false, and nothing that merely acts like one.</summary>
            static bool Bool(JToken value, string where, string key)
            {
                if (value == null || value.Type != JTokenType.Boolean)
                    throw new LayoutException(where + ": " + key + " should be true or false");
                return value.Value<bool>();
            }

            /// <summary>An optional true-or-false field.</summary>
            static bool Flag(JObject row, string where, string key, bool fallback)
            {
                return Bool(Pick(row, key, fallback), where, key);
            }

            /// <summary>One of a fixed set of values.</summary>
            static string Choice(JToken value, string where, string key, string[] options)
            {
                string text = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                if (text == null || Array.IndexOf(options, text) < 0)
                    throw new LayoutException(where + ": " + key + " is " + JsonText.Repr(value) + "; use one of " + string.Join(", ", options));
                return text;
            }

            /// <summary>An id: lowercase letters, digits, - or _.</summary>
            static string Ident(JToken value, string where, string key)
            {
                string text = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                if (text == null || text.Length == 0 || !IsIdent(text))
                    throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " should be lowercase letters, digits, - or _");
                return text;
            }

            /// <summary>Whether an id is lowercase letters, digits, - or _.</summary>
            static bool IsIdent(string text)
            {
                char first = text[0];
                if (!((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9')))
                    return false;
                for (int i = 1; i < text.Length; i++)
                {
                    char ch = text[i];
                    if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-'))
                        return false;
                }
                return true;
            }

            /// <summary>A #RRGGBB color, in upper case.</summary>
            static string Hex(JToken value, string where, string key)
            {
                string text = value != null && value.Type == JTokenType.String ? value.Value<string>() : null;
                if (text == null || text.Length != 7 || text[0] != '#')
                    throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " should be a color like #E6DAC0");
                for (int i = 1; i < 7; i++)
                {
                    char ch = text[i];
                    bool digit = (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
                    if (!digit)
                        throw new LayoutException(where + ": " + key + " " + JsonText.Repr(value) + " should be a color like #E6DAC0");
                }
                return text.ToUpperInvariant();
            }

            /// <summary>A cell as (x, z).</summary>
            static int[] Point(JToken value, string where, string key)
            {
                var list = value as JArray;
                if (list == null || list.Count != 2)
                    throw new LayoutException(where + ": " + key + " should be [x, z]");
                return new[] { Int(list[0], where, key, null), Int(list[1], where, key, null) };
            }

            /// <summary>A record's footprint, each side running from low to high.</summary>
            static int[] BoxOf(JObject row, string where)
            {
                int x0 = Int(row["x0"], where, "x0", null);
                int x1 = Int(row["x1"], where, "x1", null);
                int z0 = Int(row["z0"], where, "z0", null);
                int z1 = Int(row["z1"], where, "z1", null);
                if (x0 > x1 || z0 > z1)
                    throw new LayoutException(where + ": x0..x1 and z0..z1 should run from low to high");
                return new[] { x0, x1, z0, z1 };
            }

            /// <summary>A field, or the fallback when the record leaves it out.</summary>
            static JToken Pick(JObject row, string key, object fallback)
            {
                JProperty prop = row.Property(key);
                if (prop == null)
                    return JToken.FromObject(fallback);
                return prop.Value;
            }

            /// <summary>Whether a record has a field.</summary>
            static bool Has(JObject row, string key)
            {
                return row != null && row.Property(key) != null;
            }

            /// <summary>Integer division that rounds down, including for a negative sum.</summary>
            static int Half(int a, int b)
            {
                int sum = a + b;
                int value = sum / 2;
                if (sum < 0 && sum % 2 != 0)
                    value--;
                return value;
            }
        }

        sealed class Floor
        {
            public string Id;
            public string Name;
            public int Slab;
            public int Height;
            public string Pen;
            public int? X0, X1, Z0, Z1;
            public int AirLow { get { return Slab + 1; } }
            public int AirHigh { get { return Slab + Height; } }
            public int[] Span { get { return X0 == null ? null : new[] { X0.Value, X1.Value, Z0.Value, Z1.Value }; } }
        }

        sealed class Room
        {
            public string Id;
            public string Floor;
            public string Name;
            public int[] Box;
            public int Y1;
            public int LabelX;
            public int LabelZ;
        }

        sealed class Street
        {
            public string Id;
            public string Floor;
            public int[] Box;
            public string Style;
            public string Label;
        }

        sealed class Door
        {
            public string Id;
            public string Floor;
            public int[] Box;
        }

        sealed class Stair
        {
            public string Id;
            public int[] Box;
            public string Low;
            public string[] Floors;
        }

        sealed class Shaft
        {
            public string Id;
            public string Floor;
            public int[] Box;
            public string Label;
        }

        sealed class Lift
        {
            public string Id;
            public int[] Box;
            public string[] Floors;
            public string Label;
        }

        sealed class Wall
        {
            public string Id;
            public string Room;
            public string Title;
            public int[] Box;
        }

        sealed class Item
        {
            public string Id;
            public int Num;
            public string Key;
            public string Label;
            public string Room;
            public string Crawl;
            public int[] Box;
        }

        sealed class CrawlSpace
        {
            public string Id;
            public string Name;
            public string Under;
            public int Low;
            public int High;
        }

        sealed class Zone
        {
            public readonly string Label;
            public readonly int[] Box;
            public readonly int[] Limit;

            public Zone(string label, int[] box, int[] limit)
            {
                Label = label;
                Box = box;
                Limit = limit;
            }
        }
    }
}
