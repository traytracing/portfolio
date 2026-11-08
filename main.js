/* ─────────────────────────────────────────────────────────────
   LUMINARY — two black holes thrown at each other.

   A WebGL2 port of the Luminary Synthesis Engine's renderer
   (github.com/traytracing/Luminary):
     • blackhole.frag  → the black-hole billboards (object.geom's
       billboard is rebuilt as an instanced quad)
     • SpaceDust.frag  → the posterised nebula sky
     • Star.frag       → sprite stars (stars-special.png, smallstars.png)
     • line.vert/frag  → fading orbit trails
   and the same N-body step as Simulation::MakeOriginalSim:
     force += k / r² · n̂,  semi-implicit Euler, adaptive dt.
   ───────────────────────────────────────────────────────────── */

const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true });
if (!gl) fail("WebGL2 isn't available in this browser.");

/* ───────────── settings (Luminary defaults where they exist) ───────────── */

const K = 10.0;                                   // Simulation.cpp: const GLfloat k = 10.0f
const FOV = 60 * Math.PI / 180;                   // Settings.h: FOVdeg 60
const NEAR = 0.01, FAR = 1000;                    // Settings.h
const TRAIL_COLOR = [0.749, 0.659, 0.565, 1.0];   // Settings.h: InitialTrailColor
let TRAIL_TIME = 2.0;                           // Settings.h: trailTime
let TRAIL_WIDTH = 5.0;                          // Settings.h: trailWidth (px)
const FPS = 60;                                   // Settings.h: Initialfps
const STAR_COUNT = 1800;

/* ───────────── shaders ───────────── */

// Sky: SpaceDust.frag, drawn on a fullscreen triangle.
const SKY_VS = `#version 300 es
uniform vec3 u_right, u_up, u_fwd;
uniform float u_th, u_aspect;
out vec3 v_dir;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
  v_dir = u_fwd + u_right * p.x * u_th * u_aspect + u_up * p.y * u_th;
}`;

const SKY_FS = `#version 300 es
precision highp float;

//change later + naming convention and 
float size = 15.0;
int OCTAVES = 8;
const float seed = 4.175;
const bool reduce_background = false;

// add const to dither
bool dither; // checker board pattern in dust | see if(dith)


float rand(vec3 dir) {
	return fract(sin(dot(dir, vec3(12.9898, 78.233, 37.719))) * (15.5453 + seed));
}

float noise(vec3 dir) {
    vec3 i = floor(dir);
    vec3 f = fract(dir);

    float a = rand(i);
    float b = rand(i + vec3(1,0,0));
    float c = rand(i + vec3(0,1,0));
    float d = rand(i + vec3(1,1,0));
    float e = rand(i + vec3(0,0,1));
    float f1= rand(i + vec3(1,0,1));
    float g = rand(i + vec3(0,1,1));
    float h = rand(i + vec3(1,1,1));

    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(
             mix(mix(a,b,u.x), mix(c,d,u.x), u.y),
             mix(mix(e,f1,u.x),mix(g,h,u.x), u.y),
             u.z);
}


float fbm3D(vec3 dir, int oct) {
    float value = 0.0;
    float amp   = 0.5;

    for (int i = 0; i < oct; ++i)
    {
        value += noise(dir) * amp;
        dir *= 2.0;
        amp *= 0.5;
    }
    return value;
}

float circleNoise3D(vec3 dir) {
    float dir_z = floor(dir.z);
    dir.xy += dir_z * vec2(0.31, 0.37);
    vec3 cell = floor(dir);
    vec3 f    = fract(dir);
    float h = rand(cell);
    float m = length(f - vec3(0.25) - h * 0.5);
    float r = h * 0.25;
    
    return smoothstep(0.0, r, m * 0.75);
}

float cloudAlpha3D(vec3 dir, int oct, int iter) {
    float acc = 0.0;
    for (int i = 0; i < iter; ++i)
    {
        acc += circleNoise3D(dir * 0.5 + float(i + 1) + vec3(-0.3, 0.0, 0.0));
    }
    return fbm3D(dir + acc, oct);
}



const float brightness = 56.0;

// finish this later NOT DONE
vec4 spaceDust(vec3 dir) {
    // noise
    size = 30.0;
    int iter = 5;
	float n_dust_circle = cloudAlpha3D(dir, OCTAVES, iter); // circle-like noise 
	float n_dust_blob = fbm3D(dir * size * 0.2  - vec3(2.0), OCTAVES); // blob-like noise
	float n_dust_alpha = fbm3D(dir * size * 0.5 + vec3(2.0), OCTAVES);
	
    float dust_value = n_dust_circle * n_dust_blob;


	// dithering | noise modifications 
	if (dither) dust_value *= 0.95;
	
	dust_value = pow(dust_value, 3.2) * brightness; // put under a_dust if it doesnt look good
	float dust_alpha = step(n_dust_alpha, dust_value * 1.8);
	
	if (dither) dust_value *= 1.1; 
	
	

	// coloring
	if (reduce_background) dust_value = pow(dust_value, 0.8) * 0.7;
	
	float normalized_color_level = floor(dust_value) / 7.0;
	
	vec3 col = vec3(normalized_color_level); // lookup color later
	
    return vec4(col, dust_alpha);
}

// finish this later NOT DONE
vec4 nebula(vec3 dir) {
	// noise
	OCTAVES = 3;
    size = 15.0;
    int iter = 2;
	float n_dust_circle = cloudAlpha3D(dir * size, OCTAVES, iter);
	float n_dust_circle_2 = cloudAlpha3D(dir * size, OCTAVES, iter);
	float n_dust_blob = fbm3D(dir * size + vec3(1.0), OCTAVES);

	float circle_value = n_dust_circle * n_dust_blob;
	float dust_value = n_dust_circle_2 * circle_value;

	// dithering | noise modifications 
	float dist = 0.25; // acos(dot(dir, nebulaCenter)) / 6.14159 const vec3 nebulaCenter = normalize(vec3(0.0, 0.0, -1.0));
	//if(dist > 1.14159) return vec4(0);

	if (dither) {
		dust_value *= 0.95;
		circle_value *= 0.95;
		dist*= 0.98;
	}

	// slightly offset alpha values to create thin bands around the nebulae
	float a = step(n_dust_blob, 0.1 + dist);
	float a2 = step(n_dust_blob, 0.115 + dist);

	// choose colors
	if (reduce_background) {
		dust_value = pow(dust_value, 1.2) * 0.7;
	}
	float col_value = 0.0;
	if (a2 > a) {
		col_value = floor(dust_value * 35.0) / 7.0;
	} else {
		col_value = floor(dust_value * 14.0) / 7.0;
	}
	
	// apply colors
	vec3 col = vec3(col_value);
	if (col_value < 0.1) {
		col = vec3(0.0901961, 0.0901961, 0.0666667); // fix later
	}

    return vec4(col, a2);
}

in vec3 v_dir;
uniform float u_fade;

out vec4 daColor;

float hash12(vec2 p){  // returns 0-1
    vec3 p3 = fract(vec3(p.xyx)*.1031);
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
}
vec2  hash22(vec2 p){ return vec2(hash12(p), hash12(p+13.37)); }

// --------- star field --------------------------
float starFieldAA(vec3 dir)
{
    // map direction to a 2-D plane (any low-distortion mapping is fine)
    vec2 uv = dir.xy / (abs(dir.z)+1.0);

    const float SCALE = 800.0;                 // density control
    vec2  gpos  = uv * SCALE;                  // grid coords
    vec2  cell  = floor(gpos);

    // pick the ~0.3 % brightest cells
    if(hash12(cell) < 0.997) return 0.0;

    // random centre *inside* the cell so stars don’t sit on grid lines
    vec2  centre = hash22(cell) - 0.5;
    vec2  dp     = fract(gpos) - centre;       // vector from star centre
    float d      = length(dp);

    // radius in “cell units” (≈ pixels at this scale)
    float R = 0.35 * rand(dir);

    // screen-space derivative = one-pixel width → smooth cutoff
    float w = fwidth(d);                       // always ≥ one pixel
    return smoothstep(R + w, R - w, d);        // 0-1 intensity
}

vec3 nyx8[8] = vec3[](
    vec3(0.031, 0.078, 0.118), // #08141e
    vec3(0.059, 0.165, 0.247), // #0f2a3f
    vec3(0.126, 0.224, 0.310), // #20394f
    vec3(0.965, 0.839, 0.741), // #f6d6bd
    vec3(0.765, 0.639, 0.541), // #c3a38a
    vec3(0.600, 0.459, 0.467), // #997577
    vec3(0.506, 0.384, 0.443), // #816271
    vec3(0.306, 0.286, 0.373)  // #4e495f
);

vec3 newP[8] = vec3[](
    vec3(0.106, 0.110, 0.173), // #1b1c2c
    vec3(0.353, 0.235, 0.286), // #5a3c49
    vec3(0.604, 0.392, 0.345), // #9a6458
    vec3(0.839, 0.635, 0.451), // #d6a273
    vec3(0.929, 0.871, 0.702), // #eddeb3
    vec3(0.612, 0.678, 0.718), // #9cadb7
    vec3(0.294, 0.357, 0.671), // #4b5bab
    vec3(0.165, 0.184, 0.290)  // #2a2f4a
);


void main()
{
    dither = mod(gl_FragCoord.x + gl_FragCoord.y, 2.0) < 1.0;
    vec3 dir      = normalize(v_dir);

    vec4 dust = spaceDust(dir);
    vec4 neb  = nebula(dir);

    float  aOut = neb.a + dust.a * (1.0 - neb.a);
    vec3   cOut = neb.rgb * neb.a + dust.rgb * (1.0 - neb.a);
     
    int cOutQuant = int (clamp(floor(cOut.x * 7.0), 0.0, 7.0) );
    cOut = newP[cOutQuant];

    vec3 stars = vec3(starFieldAA(dir));
    cOut += stars;

    daColor = vec4(cOut * u_fade, aOut);

}


/*
float bayerDither(vec2 uv) {
    int x = int(mod(uv.x, 4.0));
    int y = int(mod(uv.y, 4.0));
    int index = y * 4 + x;
    float threshold = float[16](
         0.0,  8.0,  2.0, 10.0,
        12.0,  4.0, 14.0,  6.0,
         3.0, 11.0,  1.0,  9.0,
        15.0,  7.0, 13.0,  5.0
    )[index] / 16.0;
    return threshold;
}
*/`;

// Black holes: object.geom's billboard as an instanced quad.
const HOLE_VS = `#version 300 es
layout(location = 0) in vec3 a_center;
layout(location = 1) in vec3 a_bnormal;
layout(location = 2) in float a_size;    // Mass * Size
layout(location = 3) in float a_seed;
uniform mat4 CameraMatrix;
uniform vec3 CameraPosition;
flat out vec3 Center;
out vec2 f_UV;
flat out vec3 f_BNormal;
flat out float f_Seed;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  f_Seed = a_seed;
  Center = a_center;
  f_BNormal = a_bnormal;
  vec3 dirToCam = normalize(CameraPosition - Center);
  vec3 up = f_BNormal;
  vec3 right = normalize(cross(up, dirToCam));
  vec3 billboardUp = normalize(cross(dirToCam, right));
  vec3 p = Center + right * a_size * (corner.x * 2.0 - 1.0) + billboardUp * a_size * (corner.y * 2.0 - 1.0);
  gl_Position = CameraMatrix * vec4(p, 1.0);
  f_UV = corner;
}`;

const HOLE_FS = `#version 300 es
precision highp float;

flat in vec3 Center;
in vec2 f_UV;
flat in vec3 f_BNormal;
flat in float f_Seed;

out vec4 fragColor;


const float  PIXELS_BODY  = 1000.0;
const float  RADIUS       = 0.08;
const float  LIGHT_WIDTH  = 0.02;

const vec4   BODY_COLOR[3] = vec4[3](
    vec4(vec3(0.043, 0.031, 0.118), 1.0),   // core
    vec4(vec3(0.929, 0.871, 0.702), 1.0),   // inner rim
    vec4(vec3(0.125, 0.110, 0.267), 1.0)    // hot edge
);

// ‑‑ Accretion disc (ring) ‑‑
const float  PIXELS_RING      = 1000.0;
const float  ROTATION         = 0.0;        // radians
const vec2   LIGHT_ORIGIN     = vec2(0.39); // helper for light fall‑off
const float  TIME_SPEED       = 0.20;
const float  DISK_WIDTH       = 0.03; //
const float  RING_PERSPECTIVE = 13.0; //
const bool   SHOULD_DITHER    = true;

const int    N_BAND           = 8;
/*
const vec4   RING_COLOR[N_BAND] = vec4[N_BAND](
    vec4(1.00, 1.00, 235.0 / 255.0, 1.0),
    vec4(1.00, 245.0 / 255.0, 64.0 / 255.0, 1.0),
    vec4(1.00, 184.0 / 255.0, 74.0 / 255.0, 1.0),
    vec4(237.0/ 255.0, 123.0 / 255.0, 57.0 / 255.0, 1.0),
    vec4(189.0 /255.0,  64.0 /255.0, 53.0 / 255.0, 1.0)
);*/

vec3 blackhole8[8] = vec3[](
    vec3(0.043, 0.031, 0.118), // deep space shadow        #0b0820
    vec3(0.125, 0.110, 0.267), // muted indigo             #201c44
    vec3(0.243, 0.133, 0.216), // dark magenta-violet      #3e2237
    vec3(0.459, 0.102, 0.125), // dark wine                #751a20
    vec3(0.757, 0.231, 0.110), // deep burnt red           #c13b1c
    vec3(0.933, 0.482, 0.184), // orange-red               #ee7b2f
    vec3(0.961, 0.749, 0.251), // golden yellow            #f5bf40
    vec3(0.992, 0.992, 0.831)  // pale yellow-white        #fdfdd4
);
vec3 purplehole8[8] = vec3[](
    vec3(0.043, 0.031, 0.118), // deep space shadow        #0b0820
    vec3(0.110, 0.086, 0.251), // deep indigo              #1c163f
    vec3(0.180, 0.106, 0.322), // dark violet              #2e1b52
    vec3(0.353, 0.102, 0.408), // royal purple             #5a1a68
    vec3(0.573, 0.231, 0.506), // strong purple-magenta    #923b81
    vec3(0.725, 0.388, 0.725), // mid lavender             #b964b9
    vec3(0.859, 0.659, 0.871), // pastel lilac             #dba8de
    vec3(0.961, 0.902, 0.992)  // pale lavender-white      #f5e6fd
);
vec3 purpleRedHole8[8] = vec3[](
    vec3(0.945, 0.812, 0.710), // warm dusty glow          #f1cfb5
    vec3(0.827, 0.502, 0.431), // dusty rose highlight     #d2806e
    vec3(0.682, 0.282, 0.314), // muted crimson            #ae4850
    vec3(0.486, 0.153, 0.216), // oxblood red              #7c2737
    vec3(0.314, 0.086, 0.196), // dark wine-red            #501631
    vec3(0.204, 0.090, 0.259), // purple-eggplant          #341740
    vec3(0.110, 0.086, 0.251), // deep indigo              #1c163f
    vec3(0.043, 0.031, 0.118)  // deep void                #0b0820
);

// ‑‑ Fractal noise parameters ‑‑
const float SIZE    = 2.7;
const int   OCTAVES = 8;
float SEED    = 2322.0;

/* If you keep TIME as a constant the disc is static.
   Replace it with a uniform for animation. */
uniform float TIME;
uniform float u_fade;

/* ──────────────────────────────
              Helpers
   ────────────────────────────── */
float rand(vec2 c)
{
    c  = mod(c, vec2(2.0,1.0)*round(SIZE));
    return fract(sin(dot(c, vec2(12.9898,78.233))) * 15.5453 * SEED);
}

float noise(vec2 c)
{
    vec2 i = floor(c);
    vec2 f = fract(c);

    float a = rand(i);
    float b = rand(i + vec2(1.0, 0.0));
    float d = rand(i + vec2(0.0, 1.0));
    float e = rand(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (d - a) * u.y * (1.0 - u.x) + (e - b) * u.x * u.y;
}

float fbm(vec2 c)
{
    float v = 0.0;
    float amp = 0.5;
    for(int i = 0; i < OCTAVES; ++i)
    {
        v   += noise(c) * amp;
        c   *= 2.0;
        amp *= 0.5;
    }
    return v;
}

vec2 rotate(vec2 p, float a)
{
    float s = sin(a), c = cos(a);
    p -= 0.5;
    p  = mat2(c,-s,s,c) * p;
    return p + 0.5;
}

bool dither() {
    vec2 cell = floor(gl_FragCoord.xy / 1.0);   // was 2.7: non-integer cells made uneven squares
    bool dither = mod(cell.x + cell.y, 2.0) < 1.0;
    return dither;
}

/* ──────────────────────────────
     Body (event‑horizon) pass
   ────────────────────────────── */
vec4 bodyColour(vec2 uv)
{
    // pixelise
    //uv = floor(uv * PIXELS_BODY) / PIXELS_BODY;

    float d = distance(uv, vec2(0.5));
    //d *= pow(fbm(uv * SIZE), 0.5);
    vec4  col = BODY_COLOR[0];

    if (d > RADIUS - LIGHT_WIDTH)          col = BODY_COLOR[1];
    if (d > RADIUS - LIGHT_WIDTH * 0.5)    col = BODY_COLOR[2];
    if(d > RADIUS) return vec4(col.rgb, 0);
    float alpha = step(d, RADIUS);
    return vec4(col.rgb, 1);
}

uniform vec3 CameraPosition;

vec4 ringColour(vec2 uvReal)
{
    vec3 dir = normalize(CameraPosition - Center);

    float phi = acos(abs(dot(dir, f_BNormal)));

    vec3 ref = abs(f_BNormal.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0);

// Local tangent (right) and bitangent (up)
vec3 right = normalize(cross(ref, f_BNormal));
vec3 up    = normalize(cross(f_BNormal, right));

// Project onto the plane perpendicular to bNormal
vec3 proj = normalize(dir - dot(dir, f_BNormal) * f_BNormal);

// Express in local tangent space
float x = dot(proj, right);
float y = dot(proj, up);
    float angle2 = atan(y, x);
    
    vec2 uv = floor(uvReal * PIXELS_RING) / PIXELS_RING;
    //uv = rotate(uv, 3.14/2.0);
    bool dith = dither();
    vec2 uv0 = uv;


    float dWidth = 0.03; // diskwidth
    vec2 origin  = vec2(0.5, 0.5);
    float dist = distance(origin, uv);
    
    if(dot(dir, f_BNormal) < 0.0) {
        if (uv.y <  clamp(0.54 * sin(phi), 0.0, 0.5)) // change with angle 
    {
        float f = smoothstep(dist, 0.5, 0.2) ; // 2
        uv.y    += f; origin.y -= f;
        dWidth  += smoothstep(dist, 0.5, 0.3)  / (15.0 *cos(phi)); // 3

    } else if (uv.y > 0.5 + 0.5 * cos(phi)) // then change downwards bound 
    {if(cos(phi) >0.4) discard;
        float f = smoothstep(dist, 0.4, 0.17);
        uv.y    -= f; origin.y += f;
        dWidth  += smoothstep(dist, 0.5, 0.2);
    } else {

       dWidth  += smoothstep(dist, 0.5, 0.3)/(15.0 ); // 3
    }
    } else{
     if (uv.y > 1.0 - clamp(0.54 * sin(phi), 0.0, 0.5)) // change with angle 
    {
        float f = smoothstep(dist, 0.5, 0.2) ; // 2
        uv.y    -= f; origin.y += f;
        dWidth  += smoothstep(dist, 0.5, 0.3)  / (15.0 *cos(phi)); // 3
        
    } else if (uv.y < 0.5 - 0.5 * cos(phi)) // then change downwards bound 
    {
        if(cos(phi) >0.4) discard;
        float f = smoothstep(dist, 0.4, 0.17);
        uv.y    += f; origin.y -= f;
        dWidth  += smoothstep(dist, 0.5, 0.2);
        
    } else {
       dWidth  += smoothstep(dist, 0.5, 0.3)/(15.0 ); // 3
    } }
    

    float vpres = 1.0 / cos(phi);

    vec2  uvC = uv;

    if(dot(dir, f_BNormal) < 0.0) {
       uvC.y = (-1.0 * (uvC.y - 0.5)) * vpres + 0.5; // stretch .y only
    }  else {
        uvC.y = (uvC.y - 0.5) * vpres + 0.5; // stretch .y only

    }

    //rotate disk along disk axis
    uvC = rotate(uvC, -1.0 * angle2); uvC = rotate(uvC, TIME * TIME_SPEED * 3.0);
    float cD   = distance(uvC, vec2(0.5, 0.5));

    float lightD = 0.3 * distance(uv0 * vec2(1.0, vpres), origin * vec2(1.0, vpres)); // noise1 can change 0.3

    float disc = smoothstep(0.1 - 2.0 * dWidth, 0.5 - dWidth, cD) * smoothstep(cD - dWidth, cD, 0.4);
    disc *= pow(fbm(uvC * SIZE), 0.5); // noise2

    if (dith || !SHOULD_DITHER) disc *= 1.2;

    float band = clamp(disc + lightD, 0.0, 1.0); // 0 - 1
    

     
     

    vec3 color = purpleRedHole8[int(band * float(N_BAND - 1))];
    float alpha = step(0.15, disc);
    
    return vec4(color, alpha);
}


void main() {   
    SEED = f_Seed;
    vec4 body = bodyColour(f_UV);
    vec4 ring = ringColour(f_UV);

    /* “Over” compositing – the ring sits on top of the body */
    float a = ring.a + body.a * (1.0 - ring.a);
    vec3  c = (ring.rgb * ring.a + body.rgb * body.a * (1.0 - ring.a)) / max(a, 1e-5);
    // change 0.07 to size of center in flaot
    
    fragColor = vec4(c * u_fade, a); if(fragColor.a == 0.0) discard;
}

`;

// Stars: Star.geom's billboard as an instanced quad, Star.frag's shading.
const STAR_VS = `#version 300 es
layout(location = 0) in vec2 v_Angle;
layout(location = 1) in float v_Rotation;
layout(location = 2) in float v_Size;
layout(location = 3) in float v_StarType;
layout(location = 4) in float v_StarIndex;
uniform mat4 camMatrix;
uniform vec3 camPos;
out vec2 f_UV;
flat out int f_StarType;
flat out float f_StarIndex;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  f_StarType = int(v_StarType);
  f_StarIndex = v_StarIndex;
  // stars live on a unit sphere around the camera (a skybox)
  vec3 dirS = vec3(sin(v_Angle.x) * cos(v_Angle.y), sin(v_Angle.x) * sin(v_Angle.y), cos(v_Angle.x));
  vec3 center = camPos + dirS;
  vec3 dir = normalize(camPos - center);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(up, dir));
  vec3 billboardUp = normalize(cross(dir, right));
  float c = cos(v_Rotation), s = sin(v_Rotation);
  vec3 rRot = c * right + s * billboardUp;
  vec3 uRot = -s * right + c * billboardUp;
  vec3 p = center + rRot * v_Size * (corner.x * 2.0 - 1.0) + uRot * v_Size * (corner.y * 2.0 - 1.0);
  gl_Position = camMatrix * vec4(p, 1.0);
  f_UV = corner;
}`;

const STAR_FS = `#version 300 es
precision highp float;
in vec2 f_UV;
flat in int f_StarType;
flat in float f_StarIndex;
uniform sampler2D starLarge;   // stars-special.png: 6 sprites
uniform sampler2D starSmall;   // smallstars.png: 16 sprites
uniform float u_fade;
out vec4 daColor;
vec3 newP[8] = vec3[](
  vec3(0.106, 0.110, 0.173), vec3(0.353, 0.235, 0.286), vec3(0.604, 0.392, 0.345), vec3(0.839, 0.635, 0.451),
  vec3(0.929, 0.871, 0.702), vec3(0.612, 0.678, 0.718), vec3(0.294, 0.357, 0.671), vec3(0.165, 0.184, 0.290));
float starbrightness = 2.0;
void main() {
  vec4 g = f_StarType == 0
    ? texture(starLarge, vec2((f_UV.x + f_StarIndex) / 6.0, 1.0 - f_UV.y))
    : texture(starSmall, vec2((f_UV.x + f_StarIndex) / 16.0, 1.0 - f_UV.y));
  int brightness = int(clamp(floor(g.x * 7.0), 0.0, 7.0));
  // small stars would vanish against the tan nebula (same palette steps): keep them in the bright steps
  if (f_StarType == 1) brightness = max(brightness, 4);
  daColor = vec4(starbrightness * newP[brightness], g.a * u_fade);
}`;

// Trails: line.frag's fading colour, drawn as screen-space ribbons
// (WebGL can't draw 5 px wide GL_LINES).
const TRAIL_VS = `#version 300 es
layout(location = 0) in vec4 a_clip;
layout(location = 1) in float a_alpha;
uniform vec4 TrailColor;
out vec4 f_color;
void main() { gl_Position = a_clip; f_color = vec4(TrailColor.rgb, TrailColor.a * a_alpha); }`;

const TRAIL_FS = `#version 300 es
precision mediump float;
in vec4 f_color;
out vec4 daColor;
void main() { if (f_color.a <= 0.001) discard; daColor = f_color; }`;

/* ───────────── GL helpers ───────────── */

function fail(msg) {
  const e = document.getElementById("error");
  e.textContent = msg;
  e.hidden = false;
  throw new Error(msg);
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) fail(gl.getShaderInfoLog(s));
  return s;
}

function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail(gl.getProgramInfoLog(p));
  p.u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    p.u[name.replace("[0]", "")] = gl.getUniformLocation(p, name);
  }
  return p;
}

const skyProg = program(SKY_VS, SKY_FS);
const holeProg = program(HOLE_VS, HOLE_FS);
const starProg = program(STAR_VS, STAR_FS);
const trailProg = program(TRAIL_VS, TRAIL_FS);

function loadTexture(dataUrl, unit) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const img = new Image();
  img.onload = () => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  };
  img.src = dataUrl;
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  return tex;
}
// Luminary's own star sprites, embedded so the page works straight from disk.
const STARS_SPECIAL_PNG = "data:image/png;base64,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";
const STARS_SMALL_PNG = "data:image/png;base64,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OmFib3V0PSIiCiAgICB4bWxuczppcHRjRXh0PSJodHRwOi8vaXB0Yy5vcmcvc3RkL0lwdGM0eG1wRXh0LzIwMDgtMDItMjkvIgogICAgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICB4bWxuczpzdEV2dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIgogICAgeG1sbnM6cGx1cz0iaHR0cDovL25zLnVzZXBsdXMub3JnL2xkZi94bXAvMS4wLyIKICAgIHhtbG5zOkdJTVA9Imh0dHA6Ly93d3cuZ2ltcC5vcmcveG1wLyIKICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICB4bXBNTTpEb2N1bWVudElEPSJnaW1wOmRvY2lkOmdpbXA6ZjllODhmMmMtNjBmZS00ZjM5LWIzZWEtYTZhOWZlMTA4NTJhIgogICB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjYxMjAxMWUyLWFjZWUtNGJhZC05MmJkLTc3N2NiODc4ZjA5MSIKICAgeG1wTU06T3JpZ2luYWxEb2N1bWVudElEPSJ4bXAuZGlkOmVjZGI2ODQ5LTI5MWEtNDEyYy05MWE4LTE2ODJhZTM3NDE1NiIKICAgR0lNUDpBUEk9IjIuMCIKICAgR0lNUDpQbGF0Zm9ybT0iV2luZG93cyIKICAgR0lNUDpUaW1lU3RhbXA9IjE2MTgxMzM3NjM4NDE0MzciCiAgIEdJTVA6VmVyc2lvbj0iMi4xMC4yMiIKICAgZGM6Rm9ybWF0PSJpbWFnZS9wbmciCiAgIHRpZmY6T3JpZW50YXRpb249IjEiCiAgIHhtcDpDcmVhdG9yVG9vbD0iR0lNUCAyLjEwIj4KICAgPGlwdGNFeHQ6TG9jYXRpb25DcmVhdGVkPgogICAgPHJkZjpCYWcvPgogICA8L2lwdGNFeHQ6TG9jYXRpb25DcmVhdGVkPgogICA8aXB0Y0V4dDpMb2NhdGlvblNob3duPgogICAgPHJkZjpCYWcvPgogICA8L2lwdGNFeHQ6TG9jYXRpb25TaG93bj4KICAgPGlwdGNFeHQ6QXJ0d29ya09yT2JqZWN0PgogICAgPHJkZjpCYWcvPgogICA8L2lwdGNFeHQ6QXJ0d29ya09yT2JqZWN0PgogICA8aXB0Y0V4dDpSZWdpc3RyeUlkPgogICAgPHJkZjpCYWcvPgogICA8L2lwdGNFeHQ6UmVnaXN0cnlJZD4KICAgPHhtcE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6ZTcxOGMyOGYtMDZiNy00YWViLThmZDAtYjVmMDM1NzdhZThkIgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKFdpbmRvd3MpIgogICAgICBzdEV2dDp3aGVuPSIyMDIxLTA0LTAyVDE2OjQ0OjA3Ii8+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjNlOGQ0YzNkLWRkMDAtNDUzMS1hZmE5LTMxZWEwZjBjOGYyZSIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChXaW5kb3dzKSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyMS0wNC0wNFQyMToyNDozNiIvPgogICAgIDxyZGY6bGkKICAgICAgc3RFdnQ6YWN0aW9uPSJzYXZlZCIKICAgICAgc3RFdnQ6Y2hhbmdlZD0iLyIKICAgICAgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDozNGQ1YTc2ZC01NDk5LTRmZjgtODI1Ny02M2U3YjZkODkxODAiCiAgICAgIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkdpbXAgMi4xMCAoV2luZG93cykiCiAgICAgIHN0RXZ0OndoZW49IjIwMjEtMDQtMTFUMTE6MzY6MDMiLz4KICAgIDwvcmRmOlNlcT4KICAgPC94bXBNTTpIaXN0b3J5PgogICA8cGx1czpJbWFnZVN1cHBsaWVyPgogICAgPHJkZjpTZXEvPgogICA8L3BsdXM6SW1hZ2VTdXBwbGllcj4KICAgPHBsdXM6SW1hZ2VDcmVhdG9yPgogICAgPHJkZjpTZXEvPgogICA8L3BsdXM6SW1hZ2VDcmVhdG9yPgogICA8cGx1czpDb3B5cmlnaHRPd25lcj4KICAgIDxyZGY6U2VxLz4KICAgPC9wbHVzOkNvcHlyaWdodE93bmVyPgogICA8cGx1czpMaWNlbnNvcj4KICAgIDxyZGY6U2VxLz4KICAgPC9wbHVzOkxpY2Vuc29yPgogIDwvcmRmOkRlc2NyaXB0aW9uPgogPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+3NBkWQAAAAZiS0dEAAAAAAAA+UO7fwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+UECwkkA8/sisMAAABVSURBVFjD7ZYxCgAgDAP7/0/HSRBBO1hEyd0c2mqCNgLAAUniFjCckMEbhleHpdfL6hLSAmN2mtmIlVYDN0w6PVc2c3WvXzW2Xw4vEDsQAGEFQmJFA2Xyj3HOiz4aAAAAAElFTkSuQmCC";
loadTexture(STARS_SPECIAL_PNG, 0);
loadTexture(STARS_SMALL_PNG, 1);

/* stars: StarAttrib::random(), from a fixed seed so the sky is always the same */
const starVao = gl.createVertexArray();
{
  let z = 20240611;
  const random = () => ((z = (z * 16807) % 2147483647) / 2147483647);
  const data = new Float32Array(STAR_COUNT * 6);
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = 2 * Math.PI * random();
    const phi = Math.acos(1 - 2 * random());
    const rot = 2 * Math.PI * random();
    let s = 0.007 + 0.008 * random();
    const type = random() < 0.5 ? 0 : 1;
    const idx = Math.floor(random() * (type === 0 ? 6 : 16));
    if (type === 1) s /= 3;
    data.set([phi, theta, rot, s, type, idx], i * 6);
  }
  gl.bindVertexArray(starVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const attrs = [[0, 2, 0], [1, 1, 8], [2, 1, 12], [3, 1, 16], [4, 1, 20]];
  for (const [loc, size, off] of attrs) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off);
    gl.vertexAttribDivisor(loc, 1);
  }
}

/* black holes: per-instance center, normal, size, seed */
const OBJECT_COUNT = 60;   // buffer capacity; the live count is params.count (MakeOriginalSim uses 30)
// Settings-panel parameters (defaults = MakeOriginalSim)
const params = { count: 30, k: 10, spread: 20, speed: 0.5, duration: 30, trail: 2, trailWidth: 5, size: 1, follow: true, seed: 1 };   // duration is fixed at 30 s
const holeData = new Float32Array(OBJECT_COUNT * 8);
const holeVao = gl.createVertexArray();
const holeBuf = gl.createBuffer();
gl.bindVertexArray(holeVao);
gl.bindBuffer(gl.ARRAY_BUFFER, holeBuf);
gl.bufferData(gl.ARRAY_BUFFER, holeData.byteLength, gl.DYNAMIC_DRAW);
for (const [loc, size, off] of [[0, 3, 0], [1, 3, 12], [2, 1, 24], [3, 1, 28]]) {
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off);
  gl.vertexAttribDivisor(loc, 1);
}

/* trails */
const TRAIL_PTS = 600;   // max points per trail (2 s of history even at 240 Hz)
const TRAIL_MAX = OBJECT_COUNT * TRAIL_PTS;
const trailData = new Float32Array(TRAIL_MAX * 2 * 5);
const trailVao = gl.createVertexArray();
const trailBuf = gl.createBuffer();
gl.bindVertexArray(trailVao);
gl.bindBuffer(gl.ARRAY_BUFFER, trailBuf);
gl.bufferData(gl.ARRAY_BUFFER, trailData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
gl.bindVertexArray(null);

/* ───────────── math ───────────── */

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => scale(a, 1 / len(a));
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = t => t * t * (3 - 2 * t);

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const project = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
];

/* ───────────── simulation: Simulation::MakeOriginalSim ───────────── */

// Luminary's physics, in float32 like the C++: every body is pulled by k / r²
// along normalize(diff); semi-implicit Euler (velocity, then position with the
// new velocity); the next step is the adaptive dtgeo = min(relDist / (|Δv| / |F|)),
// times 0.9. That rule takes *longer* steps the closer two bodies get, so a very
// close pass overshoots and flings them apart — the error this scene is built on.
// The only change: dt is scaled by DT_SCALE so the motion is smooth with just two
// bodies (unscaled, it strides ~2 s at a time). The close-pass error still happens.
const f32 = Math.fround;
let TOTAL_SIM_TIME = 30;   // MakeOriginalSim's totalSimTime (10 in the original, 30 here)
const MAX_FRAMES = 25000;   // starts needing more steps than this are re-rolled (keeps load time ~1 s)
const DT_SCALE = 1;          // unscaled: exactly Luminary's step

// glm::vec4 helpers (w is always 0 for these vectors, so we keep x, y, z)
const v4add = (a, b) => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])];
const v4sub = (a, b) => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])];
const v4mul = (a, s) => [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)];
const v4dot = (a, b) => f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(f32(a[2] * b[2]) + 0));   // glm::dot
const v4len = a => f32(Math.sqrt(v4dot(a, a)));                                                       // glm::length
const v4norm = a => v4mul(a, f32(1 / f32(Math.sqrt(v4dot(a, a)))));                                  // glm::normalize

// MakeOriginalSim's loop. Returns the recorded frames [{ t, pos }] as WriteSimToFile stores them.
function makeSim(init) {
  const k = f32(params.k);
  let state = init.map(o => ({ pos: o.pos.map(f32), vel: o.vel.map(f32) }));
  const sim = [{ t: 0, pos: state.map(o => o.pos) }];
  let simTime = f32(0), deltaTime = f32(0.0000000001);

  const updateSim = () => {
    let dtgeo = f32(Math.pow(10, 20));
    const allNew = state.map((oi, i) => {
      let force = [0, 0, 0];
      for (let j = 0; j < state.length; j++) {
        if (j === i) continue;
        const diff = v4sub(state[j].pos, oi.pos);
        const relDist = v4len(diff);
        force = v4add(force, v4mul(v4norm(diff), f32(k / Math.pow(relDist, 2))));   // k / pow(relDist, 2) in double, cast to GLfloat
        const relVel = f32(v4len(v4sub(oi.vel, state[j].vel)) / v4len(force));
        dtgeo = Math.min(dtgeo, f32(relDist / relVel));
      }
      const newVel = v4add(oi.vel, v4mul(force, deltaTime));
      const newPos = v4add(oi.pos, v4mul(newVel, deltaTime));
      return { pos: newPos, vel: newVel };
    });
    state = allNew;
    sim.push({ t: simTime, pos: state.map(o => o.pos) });
    return f32(f32(dtgeo * f32(0.9)) * DT_SCALE);
  };

  TOTAL_SIM_TIME = params.duration;
  while (simTime < TOTAL_SIM_TIME) {
    if (sim.length > MAX_FRAMES) return null;   // a very close pass makes dt tiny: too slow, reject this start
    deltaTime = updateSim();
    simTime = f32(simTime + deltaTime);
  }
  return sim;
}

// InputDataProcessorCuda.cu · InterpolateChunkKernel: first data frame with time ≥
// renderTime, then quadratic (Lagrange) interpolation through three frames.
function sample(frames, renderTime) {
  const n = frames.length;
  if (n === 1) return frames[0].pos;
  if (n === 2) {
    const t0 = frames[0].t, t1 = frames[1].t, denom = f32(t1 - t0);
    if (denom === 0) return frames[0].pos;
    const a = f32(f32(renderTime - t0) / denom);
    return frames[0].pos.map((p, o) => [0, 1, 2].map(c => f32(p[c] + f32(f32(frames[1].pos[o][c] - p[c]) * a))));
  }
  let right = 0;
  while (right < n && frames[right].t < renderTime) ++right;
  let i0, i1, i2;
  if (right <= 1) { i0 = 0; i1 = 1; i2 = 2; }
  else if (right >= n - 1) { i0 = n - 3; i1 = n - 2; i2 = n - 1; }
  else { i0 = right - 1; i1 = right; i2 = right + 1; }
  const t0 = frames[i0].t, t1 = frames[i1].t, t2 = frames[i2].t, t = renderTime;
  const d0 = f32(f32(t0 - t1) * f32(t0 - t2)), d1 = f32(f32(t1 - t0) * f32(t1 - t2)), d2 = f32(f32(t2 - t0) * f32(t2 - t1));
  return frames[i1].pos.map((_, o) => {
    const p0 = frames[i0].pos[o], p1 = frames[i1].pos[o], p2 = frames[i2].pos[o];
    if (d0 === 0 || d1 === 0 || d2 === 0) return p1;
    const l0 = f32(f32(f32(t - t1) * f32(t - t2)) / d0);
    const l1 = f32(f32(f32(t - t0) * f32(t - t2)) / d1);
    const l2 = f32(f32(f32(t - t0) * f32(t - t1)) / d2);
    return [0, 1, 2].map(c => f32(f32(f32(p0[c] * l0) + f32(p1[c] * l1)) + f32(p2[c] * l2)));
  });
}

// A run exactly like MakeOriginalSim: 30 objects, positions uniform in
// [-20, 20]³, velocities uniform in [-0.5, 0.5]³. Render attributes as in
// NbodyRenderer: random disc normal (phi, theta), Mass = log((i + 1) · 50),
// Size = 0.2, random seed in [0, 20000).
let bodies = [], frames = [], runStart = 0, clock = 0;
let trails = [];
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function newRun() {
  const rand = mulberry32(params.seed);   // same seed = same run
  const U = (a, b) => a + rand() * (b - a);
  let init;
  do {
    init = [];
    for (let i = 0; i < params.count; i++) {
      const R = params.spread, V = params.speed;
      init.push({ pos: [U(-R, R), U(-R, R), U(-R, R)], vel: [U(-V, V), U(-V, V), U(-V, V)] });
    }
    frames = makeSim(init);
  } while (!frames);
  bodies = init.map((o, i) => {
    const theta = 2 * Math.PI * rand(), phi = Math.acos(1 - 2 * rand());
    return {
      pos: o.pos.slice(),
      bnormal: [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)],
      size: 0.2 * Math.log((i + 1) * 50), seed: 20000 * rand(), scale: 1,
    };
  });
  runStart = clock;
  trails = bodies.map(() => []);
}
// The default run: a saved simulation (frames recorded from a run I liked), played back
// exactly as a fresh one would be. "new run" / the seed field generate random ones.
async function loadSaved() {
  const [bin, meta] = await Promise.all([
    fetch("run.bin").then(r => r.arrayBuffer()), fetch("default-run.json").then(r => r.json())]);
  const [N, B] = new Uint32Array(bin, 0, 2);
  const t = new Float32Array(bin, 8, N), p = new Float32Array(bin, 8 + N * 4, N * B * 3);
  frames = Array.from({ length: N }, (_, i) => ({
    t: t[i], pos: Array.from({ length: B }, (_, o) => Array.from(p.subarray((i * B + o) * 3, (i * B + o) * 3 + 3))) }));
  bodies = meta.bodies.map((m, i) => ({ pos: frames[0].pos[i].slice(), bnormal: m.bnormal, size: m.size, seed: m.seed, scale: 1 }));
  runStart = clock;
  trails = bodies.map(() => []);
}

/* ───────────── camera + input ───────────── */

let W = 0, H = 0;

// Fixed camera: square on to the plane the holes move in, slightly above,
// framing their path up to the shoot-off (x −6…8.3, y ±3.5).
const CAM_TARGET = [0, 0, 0];
const CAM_EYE = [0, 14, 52];   // sees the whole ±20 starting cube

function resize() {
  // Luminary renders at 1:1 pixels; keep that crisp look on high-DPI screens too.
  const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
  if (!w || !h) return;
  if (w !== W || h !== H) { W = canvas.width = w; H = canvas.height = h; }
}

/* ───────────── frame ───────────── */

let last = performance.now();
const FOLLOW_DIST = 6;       // how far behind the followed object the camera sits
let followDir = [0, 0, 1];

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 1 / 30);
  last = now;
  resize();
  clock += dt;

  // play the precomputed run back in real time; start a new pair when it ends
  let t = clock - runStart;
  // loop: when the run reaches its last frame, start it over from the beginning
  if (t > frames[frames.length - 1].t) { runStart = clock; t = 0; trails = bodies.map(() => []); }
  // Luminary renders discrete frames: renderTime = times.front() + renderFrame / fps
  const renderFrame = Math.floor(t * FPS);
  sample(frames, f32(renderFrame / FPS)).forEach((p, i) => (bodies[i].pos = p));
  const simTime = clock;

  // trails (TrailTime seconds of history)
  bodies.forEach((b, i) => {
    trails[i].push({ p: b.pos.slice(), t: simTime });
    while (trails[i].length > TRAIL_PTS || (trails[i].length && simTime - trails[i][0].t > TRAIL_TIME)) trails[i].shift();
  });

  /* camera: follow = sit behind body 0, looking at the origin (as in Luminary); otherwise fixed overview */
  let eye = CAM_EYE;
  if (params.follow) {
    const p = bodies[0].pos, l = Math.hypot(p[0], p[1], p[2]);
    if (l > 1e-3) followDir = [p[0] / l, p[1] / l, p[2] / l];
    eye = [p[0] + followDir[0] * FOLLOW_DIST, p[1] + followDir[1] * FOLLOW_DIST, p[2] + followDir[2] * FOLLOW_DIST];
  }
  const aspect = W / H;
  const vp = mul(perspective(FOV, aspect, NEAR, FAR), lookAt(eye, CAM_TARGET, [0, 1, 0]));
  const fwd = norm(sub(CAM_TARGET, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);

  const fade = 1;   // no fading

  gl.viewport(0, 0, W, H);
  const bg = [0.106, 0.110, 0.173].map(c => c * fade);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  /* sky (SkyRenderer: dust/nebula, then stars) */
  gl.useProgram(skyProg);
  gl.uniform3fv(skyProg.u.u_right, right);
  gl.uniform3fv(skyProg.u.u_up, up);
  gl.uniform3fv(skyProg.u.u_fwd, fwd);
  gl.uniform1f(skyProg.u.u_th, Math.tan(FOV / 2));
  gl.uniform1f(skyProg.u.u_aspect, aspect);
  gl.uniform1f(skyProg.u.u_fade, fade);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.useProgram(starProg);
  gl.uniformMatrix4fv(starProg.u.camMatrix, false, vp);
  gl.uniform3fv(starProg.u.camPos, eye);
  gl.uniform1i(starProg.u.starLarge, 0);
  gl.uniform1i(starProg.u.starSmall, 1);
  gl.uniform1f(starProg.u.u_fade, fade);
  gl.bindVertexArray(starVao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, STAR_COUNT);

  /* black holes (depth-tested, opaque billboards) */
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.useProgram(holeProg);
  gl.uniformMatrix4fv(holeProg.u.CameraMatrix, false, vp);
  gl.uniform3fv(holeProg.u.CameraPosition, eye);
  gl.uniform1f(holeProg.u.TIME, simTime * 6.0);
  gl.uniform1f(holeProg.u.u_fade, fade);
  const visible = bodies.filter(b => b.scale > 0.02);
  visible.forEach((b, i) => holeData.set([...b.pos, ...b.bnormal, b.size * b.scale * params.size, b.seed], i * 8));
  gl.bindVertexArray(holeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, holeBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, holeData);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, visible.length);

  /* trails (line.vert: alpha fades from newest to oldest) */
  gl.enable(gl.BLEND);
  gl.depthMask(false);
  let nv = 0;
  for (const tr of trails) {
    const n = tr.length;
    if (n < 2) continue;
    const start = nv;
    for (let i = 0; i < n; i++) {
      const c = project(vp, tr[i].p);
      const a = project(vp, tr[Math.max(0, i - 1)].p), b = project(vp, tr[Math.min(n - 1, i + 1)].p);
      let tx = (b[0] / b[3] - a[0] / a[3]) * W, ty = (b[1] / b[3] - a[1] / a[3]) * H;
      const tl = Math.hypot(tx, ty) || 1;
      const ox = (-ty / tl) * TRAIL_WIDTH / W, oy = (tx / tl) * TRAIL_WIDTH / H;   // half-width in NDC
      const alpha = (1 - (simTime - tr[i].t) / TRAIL_TIME) * fade;
      trailData.set([c[0] + ox * c[3], c[1] + oy * c[3], c[2], c[3], alpha], nv * 5); nv++;
      trailData.set([c[0] - ox * c[3], c[1] - oy * c[3], c[2], c[3], alpha], nv * 5); nv++;
    }
    tr.range = [start, nv - start];
  }
  if (nv) {
    gl.useProgram(trailProg);
    gl.uniform4fv(trailProg.u.TrailColor, TRAIL_COLOR);
    gl.bindVertexArray(trailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailData, 0, nv * 5);
    for (const tr of trails) if (tr.range && tr.length >= 2) gl.drawArrays(gl.TRIANGLE_STRIP, tr.range[0], tr.range[1]);
  }
  gl.depthMask(true);

  requestAnimationFrame(frame);
}
// falls back to a random run if the saved one can't be fetched (e.g. page opened as file://)
loadSaved().catch(() => newRun()).then(() => requestAnimationFrame(frame));


/* ───────────── settings panel ───────────── */
{
  const panel = document.getElementById("panel");
  const live = { trail: v => (TRAIL_TIME = v), trailWidth: v => (TRAIL_WIDTH = v), size: () => {} };
  const fmt = (k, v) => (k === "count" || k === "duration" ? v : +v.toFixed(2)) + (k === "duration" ? " s" : k === "trail" ? " s" : k === "trailWidth" ? " px" : "");
  panel.querySelectorAll("input[type=range]").forEach(inp => {
    const k = inp.dataset.p, out = inp.parentElement.querySelector("output");
    inp.value = params[k]; out.textContent = fmt(k, params[k]);
    inp.addEventListener("input", () => {
      params[k] = +inp.value; out.textContent = fmt(k, params[k]);
      if (live[k]) live[k](params[k]);
    });
    if (!live[k]) inp.addEventListener("change", () => restart());   // changes the simulation: re-run
  });
  const seedIn = document.getElementById("seed");
  seedIn.value = params.seed;
  seedIn.addEventListener("change", () => { params.seed = (+seedIn.value | 0) || 1; seedIn.value = params.seed; restart(); });
  function restart() {
    const btn = document.getElementById("rerun");
    btn.textContent = "simulating…";
    setTimeout(() => { newRun(); btn.textContent = "new run"; }, 20);
  }
  document.getElementById("rerun").addEventListener("click", () => {
    params.seed = 1 + Math.floor(Math.random() * 999999); seedIn.value = params.seed; restart();
  });
  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(params, { count: 30, k: 10, speed: 0.5, trail: 2, follow: true, seed: 1 }); seedIn.value = 1;
    TRAIL_TIME = 2; syncCam();
    document.getElementById("rerun").textContent = "loading…";
    loadSaved().then(() => (document.getElementById("rerun").textContent = "new run"));
    panel.querySelectorAll("input[type=range]").forEach(inp => {
      inp.value = params[inp.dataset.p]; inp.parentElement.querySelector("output").textContent = fmt(inp.dataset.p, params[inp.dataset.p]);
    });
  });
  const camBtn = document.getElementById("cam");
  function syncCam() { camBtn.textContent = "camera: " + (params.follow ? "follow" : "fixed"); }
  camBtn.addEventListener("click", () => { params.follow = !params.follow; syncCam(); });
  syncCam();
}
