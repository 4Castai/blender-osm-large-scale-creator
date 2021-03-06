'use strict';
var Cesium = require('cesium');
var fsExtra = require('fs-extra');
var path = require('path');
var createGltf = require('./createGltf');
var loadObj = require('./loadObj');
var writeGltf = require('./writeGltf');

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;

module.exports = obj2gltf;

/**
 * Converts an obj file to a glTF or glb.
 *
 * @param {String} objPath Path to the obj file.
 * @param {Object} [options] An object with the following properties:
 * @param {Boolean} [options.binary=false] Convert to binary glTF.
 * @param {Boolean} [options.separate=false] Write out separate buffer files and textures instead of embedding them in the glTF.
 * @param {Boolean} [options.separateTextures=false] Write out separate textures only.
 * @param {Boolean} [options.checkTransparency=false] Do a more exhaustive check for texture transparency by looking at the alpha channel of each pixel.
 * @param {Boolean} [options.secure=false] Prevent the converter from reading textures or mtl files outside of the input obj directory.
 * @param {Boolean} [options.packOcclusion=false] Pack the occlusion texture in the red channel of the metallic-roughness texture.
 * @param {Boolean} [options.metallicRoughness=false] The values in the mtl file are already metallic-roughness PBR values and no conversion step should be applied. Metallic is stored in the Ks and map_Ks slots and roughness is stored in the Ns and map_Ns slots.
 * @param {Boolean} [options.specularGlossiness=false] The values in the mtl file are already specular-glossiness PBR values and no conversion step should be applied. Specular is stored in the Ks and map_Ks slots and glossiness is stored in the Ns and map_Ns slots. The glTF will be saved with the KHR_materials_pbrSpecularGlossiness extension.
 * @param {Boolean} [options.materialsCommon=false] The glTF will be saved with the KHR_materials_common extension.
 * @param {Object} [options.overridingTextures] An object containing texture paths that override textures defined in the .mtl file. This is often convenient in workflows where the .mtl does not exist or is not set up to use PBR materials. Intended for models with a single material.
 * @param {String} [options.overridingTextures.metallicRoughnessOcclusionTexture] Path to the metallic-roughness-occlusion texture, where occlusion is stored in the red channel, roughness is stored in the green channel, and metallic is stored in the blue channel. The model will be saved with a pbrMetallicRoughness material.
 * @param {String} [options.overridingTextures.specularGlossinessTexture] Path to the specular-glossiness texture, where specular color is stored in the red, green, and blue channels and specular glossiness is stored in the alpha channel. The model will be saved with a material using the KHR_materials_pbrSpecularGlossiness extension.
 * @param {String} [options.overridingTextures.occlusionTexture] Path to the occlusion texture. Ignored if metallicRoughnessOcclusionTexture is also set.
 * @param {String} [options.overridingTextures.normalTexture] Path to the normal texture.
 * @param {String} [options.overridingTextures.baseColorTexture] Path to the baseColor/diffuse texture.
 * @param {String} [options.overridingTextures.emissiveTexture] Path to the emissive texture.
 * @param {String} [options.overridingTextures.alphaTexture] Path to the alpha texture.
 * @param {Logger} [options.logger] A callback function for handling logged messages. Defaults to console.log.
 * @param {Writer} [options.writer] A callback function that writes files that are saved as separate resources.
 * @param {String} [options.outputDirectory] Output directory for writing separate resources when options.writer is not defined.
 * @return {Promise} A promise that resolves to the glTF JSON or glb buffer.
 */
function obj2gltf(objPath, options) {
    var defaults = obj2gltf.defaults;
    options = defaultValue(options, {});
    options.binary = defaultValue(options.binary, defaults.binary);
    options.separate = defaultValue(options.separate, defaults.separate);
    options.separateTextures = defaultValue(options.separateTextures, defaults.separateTextures) || options.separate;
    options.checkTransparency = defaultValue(options.checkTransparency, defaults.checkTransparency);
    options.secure = defaultValue(options.secure, defaults.secure);
    options.packOcclusion = defaultValue(options.packOcclusion, defaults.packOcclusion);
    options.metallicRoughness = defaultValue(options.metallicRoughness, defaults.metallicRoughness);
    options.specularGlossiness = defaultValue(options.specularGlossiness, defaults.specularGlossiness);
    options.materialsCommon = defaultValue(options.materialsCommon, defaults.materialsCommon);
    options.overridingTextures = defaultValue(options.overridingTextures, defaultValue.EMPTY_OBJECT);
    options.logger = defaultValue(options.logger, getDefaultLogger());
    options.writer = defaultValue(options.writer, getDefaultWriter(options.outputDirectory));

    if (!defined(objPath)) {
        throw new DeveloperError('objPath is required');
    }

    if (options.separateTextures && !defined(options.writer)) {
        throw new DeveloperError('Either options.writer or options.outputDirectory must be defined when writing separate resources.');
    }

    if (options.metallicRoughness + options.specularGlossiness + options.materialsCommon > 1) {
        throw new DeveloperError('Only one material type may be set from [metallicRoughness, specularGlossiness, materialsCommon].');
    }

    if (defined(options.overridingTextures.metallicRoughnessOcclusionTexture) && defined(options.overridingTextures.specularGlossinessTexture)) {
        throw new DeveloperError('metallicRoughnessOcclusionTexture and specularGlossinessTexture cannot both be defined.');
    }

    if (defined(options.overridingTextures.metallicRoughnessOcclusionTexture)) {
        options.metallicRoughness = true;
        options.specularGlossiness = false;
        options.materialsCommon = false;
        options.packOcclusion = true;
    }

    if (defined(options.overridingTextures.specularGlossinessTexture)) {
        options.metallicRoughness = false;
        options.specularGlossiness = true;
        options.materialsCommon = false;
    }

    return loadObj(objPath, options)
        .then(function(objData) {
            return createGltf(objData, options);
        })
        .then(function(result) {
            return writeGltf(result.gltf, options)
                .then(function(gltf) {
                    return {
                        gltf : gltf,
                        batchTableJson : result.batchTableJson
                    };
                });
        });
}

function getDefaultLogger() {
    return function(message) {
        console.log(message);
    };
}

function getDefaultWriter(outputDirectory) {
    if (defined(outputDirectory)) {
        return function(file, data) {
            var outputFile = path.join(outputDirectory, file);
            return fsExtra.outputFile(outputFile, data);
        };
    }
}

/**
 * Default values that will be used when calling obj2gltf(options) unless specified in the options object.
 */
obj2gltf.defaults = {
    /**
     * Gets or sets whether the converter will return a glb.
     * @type Boolean
     * @default false
     */
    binary : false,
    /**
     * Gets or sets whether to write out separate buffer and texture,
     * shader files, and textures instead of embedding them in the glTF.
     * @type Boolean
     * @default false
     */
    separate : false,
    /**
     * Gets or sets if glTF use occlusition texture.
     * Tips : If origin use blinn-phong material, use occlusition will make model looks darker.
     */
    useOcclusion : false,
    /**
     * Gets or sets whether to write out separate textures only.
     * @type Boolean
     * @default false
     */
    separateTextures : false,
    /**
     * Gets or sets whether the converter will do a more exhaustive check for texture transparency by looking at the alpha channel of each pixel.
     * @type Boolean
     * @default false
     */
    checkTransparency : false,
    /**
     * Gets or sets whether the source model can reference paths outside of its directory.
     * @type Boolean
     * @default false
     */
    secure : false,
    /**
     * Gets or sets whether to pack the occlusion texture in the red channel of the metallic-roughness texture.
     * @type Boolean
     * @default false
     */
    packOcclusion : false,
    /**
     * Gets or sets whether rhe values in the .mtl file are already metallic-roughness PBR values and no conversion step should be applied. Metallic is stored in the Ks and map_Ks slots and roughness is stored in the Ns and map_Ns slots.
     * @type Boolean
     * @default false
     */
    metallicRoughness : false,
    /**
     * Gets or sets whether the values in the .mtl file are already specular-glossiness PBR values and no conversion step should be applied. Specular is stored in the Ks and map_Ks slots and glossiness is stored in the Ns and map_Ns slots. The glTF will be saved with the KHR_materials_pbrSpecularGlossiness extension.
     * @type Boolean
     * @default false
     */
    specularGlossiness : false,
    /**
     * Gets or sets whether the glTF will be saved with the KHR_materials_common extension.
     * @type Boolean
     * @default false
     */
    materialsCommon : false
};

/**
 * A callback function that logs messages.
 * @callback Logger
 *
 * @param {String} message The message to log.
 */

/**
 * A callback function that writes files that are saved as separate resources.
 * @callback Writer
 *
 * @param {String} file The relative path of the file.
 * @param {Buffer} data The file data to write.
 * @returns {Promise} A promise that resolves when the file is written.
 */
