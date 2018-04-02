//=============================================================================
// LN_AdvancedMapPuzzleSystem.js
// ----------------------------------------------------------------------------
// Copyright (c) 2018 lriki
// This software is released under the MIT License.
// http://opensource.org/licenses/mit-license.php
// ----------------------------------------------------------------------------
// [GitHub] : https://github.com/lriki/RPGMakerMV
// [Twitter]: https://twitter.com/lriki8
//=============================================================================

/*:ja
 * @plugindesc 謎解きマップシステムプラグイン v0.2.0
 * @author lriki
 * 
 * @param GuideLineTerrainTag
 * @desc 箱オブジェクトの移動ガイドラインとなる地形タグです。
 * @default 7
 * @type number
 *
 * @help マップ上のキャラクター移動やイベントシステムを拡張し、
 * 謎解きの幅を広げるための様々な機能を追加します。
 * 
 * リリースノート：https://github.com/lriki/RPGMakerMV/milestones
 * 
 * MIT License
 */

(function(_global) {
    var pluginName = 'LN_AdvancedMapPuzzleSystem';

    // ガイドラインの地形タグ
    //-----------------------------------------------------------------------------
    // params
    
    var paramGuideLineTerrainTag     = PluginManager.parameters(pluginName)["GuideLineTerrainTag"];//getParamBoolean(['GuideLineTerrainTag', 'ガイドラインの地形タグ']);


    function splitExt(filename) {
        return filename.split(/\.(?=[^.]+$)/);
    }

    var _gsJumpSe = {name: "Evasion1", volume: 80, pitch: 110, pan: 0};

    //-----------------------------------------------------------------------------
    // SoundManager
    // 　

    var _SoundManager_preloadImportantSounds = SoundManager.preloadImportantSounds;
    SoundManager.preloadImportantSounds = function() {
        _SoundManager_preloadImportantSounds.apply(this, arguments);
        if ($dataSystem) {
            // ジャンプ音をシステムサウンドとしてロード
            AudioManager.loadStaticSe(_gsJumpSe);
        }
    };

    SoundManager.playGSJump = function() {
        if ($dataSystem) {
            AudioManager.playStaticSe(_gsJumpSe);
        }
    };

    
    
    //-----------------------------------------------------------------------------
    // Game_Map

    // fully override
    Game_Map.prototype.checkPassage = function(x, y, bit) {
        var flags = this.tilesetFlags();
        var tiles = this.allTiles(x, y);
        for (var i = 0; i < tiles.length; i++) {
            var flag = flags[tiles[i]];

            ////////// ガイドラインタグを通行判定から無視する
            var tag = flags[tiles[i]] >> 12;
            if (tag == paramGuideLineTerrainTag)
                continue;
            //////////

            if ((flag & 0x10) !== 0)  // [*] No effect on passage
                continue;
            if ((flag & bit) === 0)   // [o] Passable
                return true;
            if ((flag & bit) === bit) // [x] Impassable
                return false;
        }
        return false;
    };

    // 全方位進入禁止確認
    Game_Map.prototype.checkNotPassageAll = function(x, y) {
        var flags = this.tilesetFlags();
        var tiles = this.allTiles(x, y);
        var bits = 0;
        for (var i = 0; i < tiles.length; i++) {
            var flag = flags[tiles[i]];
            bits |= flag;
        }
        return (bits & 0x0f) == 0x0f;
    };


    // 溝チェック
    Game_Map.prototype.checkGroove = function(x, y) {
        var tiles = this.allTiles(x, y);
        for (var i = 0; i < tiles.length; i++) {
            if (Tilemap.isTileA1(tiles[i])) {
                return true;
            }
        }
        return false;
    }

    
    //-----------------------------------------------------------------------------
    // MovingResult
    //

    function MovingResult() {
        this.initialize.apply(this, arguments);
    }

    /**
     * 
     * @param {*} pass 成否
     * @param {*} x 移動先の論理絶対 X 座標
     * @param {*} y 移動先の論理絶対 Y 座標
     */
    MovingResult.prototype.initialize = function(pass, x, y) {
        this._pass = pass;
        this._x = x || -1;
        this._y = y || -1;
    };

    MovingResult.prototype.pass = function() {
        return this._pass;
    };

    MovingResult.prototype.x = function() {
        return this._x;
    };

    MovingResult.prototype.y = function() {
        return this._y;
    };

    //-----------------------------------------------------------------------------
    // MovingHelper
    // 　

    function MovingHelper() {
        throw new Error('This is a static class');
    }

    MovingHelper.isHalfStepX = function(character) {
        return Math.floor(character.x) !== character.x;
    };

    MovingHelper.isHalfStepY = function(character) {
        return Math.floor(character.y) !== character.y;
    };

    // ちなみにこれ系の "round" は マップのループ対応のための繰り返しを意味する
    MovingHelper.roundXWithDirectionLong = function(x, d, len) {
        var ic = Math.floor(len);
        var dx = $gameMap.roundXWithDirection(x, d);
        for (var i = 0; i < ic - 1; i++) {
            dx = $gameMap.roundXWithDirection(dx, d);
        }

        // 端数分の処理
        var f = len - Math.floor(len);
        if (f > 0) {
            dx += $gameMap.roundXWithDirection(0, d) * f;
        }
        return dx;
    };
    
    MovingHelper.roundYWithDirectionLong = function(y, d, len) {
        var ic = Math.floor(len);
        var dy = $gameMap.roundYWithDirection(y, d);
        for (var i = 0; i < ic - 1; i++) {
            dy = $gameMap.roundYWithDirection(dy, d);
        }

        // 端数分の処理
        var f = len - Math.floor(len);
        if (f > 0) {
            dy += $gameMap.roundYWithDirection(0, d) * f;
        }
        return dy;
    };

    MovingHelper.canPassJumpGroove = function(character, x, y, d) {
        if (d == 2 || d == 8) {
            //var nearYOffset = y - Math.floor(y);
            //var jumpLen = 2 - nearYOffset;

            if (MovingHelper.isHalfStepX(character)) {
                // X半歩状態での上下移動は、移動先隣接2タイルをチェックする。
                // 両方移動可能ならOK
    
                var r1 = MovingHelper.canPassJumpGrooveInternal(character, x - 1.0, y, d, 2);
                var r2 = MovingHelper.canPassJumpGrooveInternal(character, x, y, d, 2);
    
                if (!r1.pass() || !r2.pass()) {
                    return new MovingResult(false);
                }
    
                return r2;
            }
        }

        return MovingHelper.canPassJumpGrooveInternal(character, x, y, d, 2);
    }

    MovingHelper.canPassJumpGrooveInternal = function(character, x, y, d) {
        var x1 = Math.round(x);
        var y1 = Math.round(y);
        var x2 = Math.round(MovingHelper.roundXWithDirectionLong(x, d, 2));
        var y2 = Math.round(MovingHelper.roundYWithDirectionLong(y, d, 2));
        var x3 = Math.round(MovingHelper.roundXWithDirectionLong(x, d, 1));
        var y3 = Math.round(MovingHelper.roundYWithDirectionLong(y, d, 1));
        var toX = MovingHelper.roundXWithDirectionLong(x, d, 2);
        var toY = MovingHelper.roundYWithDirectionLong(y, d, 2);
        if (!$gameMap.isValid(x2, y2)) {
            // マップ外
            return new MovingResult(false);
        }
        if (!$gameMap.isPassable(x1, y1, d))
        {
            // 現在位置から移動できない
            return new MovingResult(false);
        }
        var d2 = character.reverseDir(d);
        if (!$gameMap.isPassable(x2, y2, d2))
        {
            // 移動先から手前に移動できない
            return new MovingResult(false);
        }
        if (character.isCollidedWithCharacters(toX, toY)) {
            // 移動先にキャラクターがいる
            return new MovingResult(false);
        }
        if (!$gameMap.checkGroove(x3, y3)) {
            // 目の前のタイルが溝ではない
            return new MovingResult(false);
        }
        return new MovingResult(true, x2, y2);
    }

    /**
     * 
     * @param {*} x 現在位置X(丸めない)
     * @param {*} y 現在位置Y(丸めない)
     * @param {*} d 現在の向き
     * @param {*} len 移動量
     */
    MovingHelper.checkJumpGroundToGroundInternal = function(character, x, y, d, len) {
        var iFromX = Math.round(x);
        var iFromY = Math.round(y);
        var toX = MovingHelper.roundXWithDirectionLong(x, d, len);
        var toY = MovingHelper.roundYWithDirectionLong(y, d, len);
        var iToX = Math.round(toX);
        var iToY = Math.round(toY);
        if (!$gameMap.isValid(iToX, iToY)) {
            // マップ外
            return new MovingResult(false);
        }
        var d2 = character.reverseDir(d);
        if ($gameMap.isPassable(iFromX, iFromY, d) || $gameMap.isPassable(iToX, iToY, d2))
        {
            // 現在位置から移動できるなら崖ではない。
            // 移動先から手前に移動できるなら崖ではない。
            return new MovingResult(false);
        } 
        if ($gameMap.checkNotPassageAll(iToX, iToY))
        {
            // 移動先が全方位進入禁止。壁とか。
            return new MovingResult(false);
        }
        if (character.isCollidedWithCharacters(toX, toY)) {
            // 移動先にキャラクターがいる
            return new MovingResult(false);
        }
        return new MovingResult(true, toX, toY);
    }

    MovingHelper.checkMoveOrJumpGroundToObject = function(x, y, d, length) {
        var x1 = Math.round(x);
        var y1 = Math.round(y);
        // 移動先座標を求める
        var new_x = Math.round(MovingHelper.roundXWithDirectionLong(x, d, length));
        var new_y = Math.round(MovingHelper.roundYWithDirectionLong(y, d, length));
        
        if ($gameMap.isPassable(x1, y1, d)) {
            // 現在位置から移動できるなら崖ではない
            return null;
        }

        // 乗れそうなオブジェクトを探す
        var events = $gameMap.events();
        var obj = null;
        for(var i = 0; i < events.length; i++) {
            if(events[i].checkPassRide(new_x, new_y)) {
                obj = events[i];
                break;
            };
        };
        if (obj) {
            return obj;
        }

        return null;
    }

    MovingHelper.checkMoveOrJumpObjectToGround = function(character, x, y, d, length) {
        // ジャンプ先座標を求める
        var new_x = Math.round(MovingHelper.roundXWithDirectionLong(x, d, length));
        var new_y = Math.round(MovingHelper.roundYWithDirectionLong(y, d, length));
        var d2 = character.reverseDir(d);
        if ($gameMap.isPassable(new_x, new_y, d2)) {
            // 移動先から手前に移動できるなら崖ではない
            return false;
        }
        if ($gameMap.checkNotPassageAll(new_x, new_y))
        {
            // 移動先が全方位進入禁止。壁とか。
            return false;
        }
        if (character.isCollidedWithCharacters(new_x, new_y)) {
            // 移動先にキャラクターがいる
            return false;
        }
        return true;
    }

    MovingHelper.checkMoveOrJumpObjectToObject = function(x, y, d, length) {
        // ジャンプ先座標を求める
        var new_x = Math.round(MovingHelper.roundXWithDirectionLong(x, d, length));
        var new_y = Math.round(MovingHelper.roundYWithDirectionLong(y, d, length));

        // 乗れそうなオブジェクトを探す
        var events = $gameMap.events();
        var obj = null;
        for(var i = 0; i < events.length; i++) {
            if(events[i].checkPassRide(new_x, new_y)) {
                obj = events[i];
                break;
            };
        };
        if (obj) {
            return obj;
        }

        return null;
    }

    
    MovingHelper.findObjectByObjectId = function(objectId) {

        var events = $gameMap.events();
        for(var i = 0; i < events.length; i++) {
            if(events[i].gsObjectId() == objectId) {
                return events[i];
            }
        }
        return null;
    }

    // id: 0=Player, 1~=Event
    MovingHelper.findCharacterById = function(id) {
        if (id == 0) {
            return $gamePlayer;
        }
        var events = $gameMap.events();
        return events[id - 1];
    }

    MovingHelper.findObject = function(x, y, ridding) {
        var events = $gameMap.eventsXyNt(x, y);
        for(var i = 0; i < events.length; i++) {
            if(events[i].isMapObject()) {
                return events[i];
            }
        }
        return null;
    }

    MovingHelper.findObjectLineRange = function(character, d, ranegLength) {

        for (var iLen = 0; iLen < ranegLength; iLen++) {
            var dx = Math.round(MovingHelper.roundXWithDirectionLong(character._x, d, iLen + 1));
            var dy = Math.round(MovingHelper.roundYWithDirectionLong(character._y, d, iLen + 1));

            var events = $gameMap.eventsXyNt(dx, dy);
            for(var iEvent = 0; iEvent < events.length; iEvent++) {
                if(events[iEvent].isMapObject()) {
                    return events[iEvent];
                }
            }
        }

        return null;
    }

    // t:現在時間(0.0～d) b:開始値 c:値の変化量 (目標値-開始値) d:変化にかける時間
    MovingHelper.linear = function(t, b, c, d) {
		return c * (t / d) + b;
    };
    
    MovingHelper.easeInExpo = function(t, b, c, d) {
		return c * Math.pow(2.0, 10.0 * (t / d - 1.0)) + b;
    };

    MovingHelper.distance2D = function(x0, y0, x1, y1) {
        var x = x1 - x0;
        var y = y1 - y0;
        return Math.sqrt( x * x + y * y );
    }
    
    //-----------------------------------------------------------------------------
    // Game_CharacterBase
    // 　
    Game_BattlerBase.JUMP_WAIT_COUNT   = 15;

    Game_BattlerBase.MOVINGMODE_DEFAULT   = 0;
    Game_BattlerBase.MOVINGMODE_PUSHED   = 1;
    Game_BattlerBase.MOVINGMODE_PUSHING   = 2;

    var _Game_CharacterBase_initMembers = Game_CharacterBase.prototype.initMembers;
    Game_CharacterBase.prototype.initMembers = function() {
        _Game_CharacterBase_initMembers.apply(this, arguments);
        this._ridingCharacterId = -1;
        this._ridderCharacterId = -1;
        this._ridingScreenZPriorityFlag = false;
        this._ridingScreenZPriorityFlag = false;
        this._waitAfterJump = 0;
        this._nowGetOnOrOff = 0;    // オブジェクトへの乗降のための移動中 (1:乗る 2:降りる)
        this._getonFrameCount = 0;
        this._getonFrameMax = 0;
        this._getonStartX = 0;
        this._getonStartY = 0;

        this._movingMode = Game_BattlerBase.MOVINGMODE_DEFAULT; // どのような原因で移動中であるか。stop でリセット
        this._orignalMovingSpeed = 0;
        this._movingBehavior = null;    // owner であれば持っている
        this._movingBehaviorOwnerCharacterId = -1;  // save に備えて参照ではなく番号で保持。0:player, 1~:event
    }

    var _Game_CharacterBase_screenZ = Game_CharacterBase.prototype.screenZ;
    Game_CharacterBase.prototype.screenZ = function() {
        var base = _Game_CharacterBase_screenZ.apply(this, arguments);
        return base + (this._ridingScreenZPriorityFlag ? 5 : 0);
    };

    var _Game_CharacterBase_moveStraight = Game_CharacterBase.prototype.moveStraight;
    Game_CharacterBase.prototype.moveStraight = function(d) {
        if (this._waitAfterJump > 0) {
            this._waitAfterJump--;
            return;
        }


        if (this.ridding()) {
            // 何かのオブジェクトに乗っている。
            // オリジナルの処理を含め、移動処理は行わない。

            if (this.tryMoveObjectToGround(d)) {
            }
            else if (this.tryMoveObjectToObject(d)) {
            }
            else if (MovingHelper.checkMoveOrJumpObjectToGround(this, this._x, this._y, d, 2)) {
                this.setMovementSuccess(true);
                this.jumpToDir(d, 2, false);
                this.getOffFromObject();
                this._nowGetOnOrOff = 2;
            }
            else {
                var obj = MovingHelper.checkMoveOrJumpObjectToObject(this._x, this._y, d, 2);
                if (obj != null) {
                    this.setMovementSuccess(true);
                    this.jumpToDir(d, 2, true);
                    this.getOffFromObject();
                    this.rideToObject(obj);
                    this.startJumpToObject();
                    this._nowGetOnOrOff = 1;
                }
            }
            
            this.setDirection(d);
        }
        else {
            _Game_CharacterBase_moveStraight.apply(this, arguments);
            if (!this.isMovementSucceeded()) {
                // 普通の移動ができなかったので特殊な移動を試みる
                if (this.tryJumpGroundToGround(d)) {
                }
                else if (this.tryJumpGroove(d)) {
                }
                else if (this.tryMoveGroundToObject(d)) {
                }
                else if (this.tryJumpGroundToObject(d)) {
                }
                else if (MovingBehavior_PushMoving.tryPushObjectAndMove(this, d)) {
                }
            }
        }
    };
    
    var _Game_CharacterBase_moveDiagonally = Game_CharacterBase.prototype.moveDiagonally;
    Game_CharacterBase.prototype.moveDiagonally = function(d) {
        if (this.ridding()) {
            // 何かのオブジェクトに乗っている。
            // オリジナルの処理を含め、移動処理は行わない。
        }
        else {
            _Game_CharacterBase_moveDiagonally.apply(this, arguments);
        }
    }

    Game_CharacterBase.prototype.tryJumpGroundToGround = function(d) {
        if (this.canPassJumpGroundToGround(this._x, this._y, d).pass()) {
            this.setMovementSuccess(true);
            this.jumpToDir(d, 2, false);
            return true;
        }
        return false;
    }
    
    Game_CharacterBase.prototype.tryJumpGroove = function(d) {
        if (MovingHelper.canPassJumpGroove(this, this._x, this._y, d).pass()) {
            this.setMovementSuccess(true);
            this.jumpToDir(d, 2, false);
            return true;
        }
        return false;
    }

    Game_CharacterBase.prototype.tryMoveGroundToObject = function(d) {
        var obj = MovingHelper.checkMoveOrJumpGroundToObject(this._x, this._y, d, 1);
        if (obj != null) {
            this.setMovementSuccess(true);
            // 乗る
            this.startMoveToObjectOrGround();
            this.moveToDir(d, true);
            this.rideToObject(obj);
            this._nowGetOnOrOff = 1;
            return true;
        }
        return false;
    }
    
    Game_CharacterBase.prototype.tryMoveObjectToGround = function(d) {
        if (MovingHelper.checkMoveOrJumpObjectToGround(this, this._x, this._y, d, 1)) {
            this.setMovementSuccess(true);
            // 降りる
            this.startMoveToObjectOrGround();
            this.moveToDir(d, false);
            this.getOffFromObject();
            this._nowGetOnOrOff = 2;
            return true;
        }
        return false;
    }

    Game_CharacterBase.prototype.tryMoveObjectToObject = function(d) {
        var obj = MovingHelper.checkMoveOrJumpObjectToObject(this._x, this._y, d, 1);
        if (obj != null) {
            this.setMovementSuccess(true);
            this.startMoveToObjectOrGround();
            this.moveToDir(d, false);
            this.getOffFromObject();
            this.rideToObject(obj);
            this._nowGetOnOrOff = 1;
            return true;
        }
        return false;
    }
    
    Game_CharacterBase.prototype.tryJumpGroundToObject = function(d) {
        var obj = MovingHelper.checkMoveOrJumpGroundToObject(this._x, this._y, d, 2);
        this.setMovementSuccess(obj != null);
        if (this.isMovementSucceeded()) {
            // 乗る
            this.jumpToDir(d, 2, true);
            this.rideToObject(obj);
            this.startJumpToObject();
            this._nowGetOnOrOff = 1;
            return true;
        }
        return false;
    };










    Game_CharacterBase.prototype.moveToDir = function(d, withAjust) {


        this._x = $gameMap.roundXWithDirection(this._x, d);
        this._y = $gameMap.roundYWithDirection(this._y, d);
        this._realX = $gameMap.xWithDirection(this._x, this.reverseDir(d));
        this._realY = $gameMap.yWithDirection(this._y, this.reverseDir(d));

        //var y = this._y;
        if (withAjust) {
            this._y = Math.round(this._y);
        }
    }

    // 方向と距離を指定してジャンプ開始
    Game_CharacterBase.prototype.jumpToDir = function(d, len, toObj) {
        // x1, y1 は小数点以下を調整しない。ジャンプ後に 0.5 オフセット無くなるようにしたい
        var x1 = this._x;
        var y1 = this._y;

        if (!toObj)
        {
            // 地面への移動は端数でも普通に平行移動でよい
            x1 = Math.round(this._x);

            if (d == 2 || d == 8) {
                // 上下移動の時は端数を捨てて自然な動きに見えるようにする
            }
            else {
                y1 = Math.round(this._y);
            }
        }

        var x2 = Math.round(MovingHelper.roundXWithDirectionLong(this._x, d, len));
        var y2 = Math.round(MovingHelper.roundYWithDirectionLong(this._y, d, len));
        this.jump(x2 - x1, y2 - y1);
        this._waitAfterJump = Game_BattlerBase.JUMP_WAIT_COUNT;
        SoundManager.playGSJump();
    }

    var _Game_CharacterBase_jump = Game_CharacterBase.prototype.jump;
    Game_CharacterBase.prototype.jump = function(xPlus, yPlus) {
        _Game_CharacterBase_jump.apply(this, arguments);
        this.getOffFromObject();    // 降りる
    }

    var _Game_CharacterBase_locate = Game_CharacterBase.prototype.locate;
    Game_CharacterBase.prototype.locate = function(x, y) {
        _Game_CharacterBase_locate.apply(this, arguments);
        this.getOffFromObject();    // 降りる
    };

    Game_CharacterBase.prototype.canPassJumpGroundToGround = function(x, y, d) {
        var x1 = Math.round(x);
        var y1 = Math.round(y);
        var x2 = Math.round(MovingHelper.roundXWithDirectionLong(x, d, 2));
        var y2 = Math.round(MovingHelper.roundYWithDirectionLong(y, d, 2));

        if (d == 2 || d == 8) {
            var nearYOffset = y - Math.floor(y);
            var jumpLen = 2 - nearYOffset;

            if (MovingHelper.isHalfStepX(this)) {
                // X半歩状態での上下移動は、移動先隣接2タイルをチェックする。
                // 両方移動可能ならOK
    
                var r1 = MovingHelper.checkJumpGroundToGroundInternal(this, x - 1.0, y, d, jumpLen);
                var r2 = MovingHelper.checkJumpGroundToGroundInternal(this, x, y, d, jumpLen);
    
                if (!r1.pass() || !r2.pass()) {
                    return new MovingResult(false);
                }
    
                return r2;
            }

            return MovingHelper.checkJumpGroundToGroundInternal(this, x, y, d, jumpLen);
        }
        else if (MovingHelper.isHalfStepY(this) && (d == 4 || d == 6)) {
            // Y半歩状態での左右移動。
            // シナリオ上とおせんぼに使いたいイベントの後ろへジャンプ移動できてしまう問題の対策。
            
            var r1 = MovingHelper.checkJumpGroundToGroundInternal(this, x, y, d, 2);
            if (!r1.pass()) {
                // 普通に移動できなかった
                return new MovingResult(false);
            }

            var iToX = r1.x();
            var iToY = Math.ceil(r1.y());
            if (this.isCollidedWithCharacters(iToX, iToY)) {
                // ceil した移動先（+0.5）にキャラクターがいる

                var r2 = MovingHelper.checkJumpGroundToGroundInternal(this, Math.round(x), iToY - 1, d, 2);
                if (!r2.pass()) {
                    // 移動できなかった
                    return new MovingResult(false);
                }
            }

            return r1;
        }

        return MovingHelper.checkJumpGroundToGroundInternal(this, x, y, d, 2);
    }
    

    

    // GS オブジェクトとしての高さ。
    // 高さを持たないのは -1。（GSObject ではない）
    Game_CharacterBase.prototype.objectHeight = function() {
        return -1;
    };

    Game_CharacterBase.prototype.canRide = function() {
        return this.objectHeight() >= 0;
    };

    Game_CharacterBase.prototype.ridding = function() {
        return this._ridingCharacterId >= 0;
    };

    // 0:プレイヤー, 1~:イベント
    Game_CharacterBase.prototype.gsObjectId = function() {
        return -1;
    };

    Game_CharacterBase.prototype.isMapObject = function() {
        return false;
    };

    // この人が乗っているオブジェクト
    Game_CharacterBase.prototype.riddingObject = function() {
        if (this._ridingCharacterId < 0) {
            return null;
        }
        else if (this._ridingCharacterId == 0) {
            return $gamePlayer;
        }
        else {
            return $gameMap.event(this._ridingCharacterId);
        }
    };

    // このオブジェクトに乗っている人
    Game_CharacterBase.prototype.rider = function() {
        if (this._ridderCharacterId < 0) {
            return null;
        }
        else if (this._ridderCharacterId == 0) {
            return $gamePlayer;
        }
        else {
            return $gameMap.event(this._ridderCharacterId);
        }
        return null;
    };
    
    Game_CharacterBase.prototype.isControlledByMovingBehavior = function() {
        if (this._movingBehavior != null) {
            return true;
        }
        if (this._movingBehaviorOwnerCharacterId >= 0) {
            return true;
        }
        return false;
    };
    
    

    

    // グローバル座標 x, yから見た時、この obj の上に乗れるか
    Game_CharacterBase.prototype.checkPassRide = function(x, y) {
        if (this.canRide() && !this.rider()) {
            var px = Math.round(this._x);
            var py = Math.round(this._y) - this.objectHeight();
            if (x == px && y == py) {
                return true;
            }
        }
        return false;
    };

    
    Game_CharacterBase.prototype.rideToObject = function(riddenObject) {
        this._ridingScreenZPriorityFlag = true;
        this._ridingCharacterId = riddenObject.gsObjectId();
        riddenObject._ridderCharacterId = this.gsObjectId();
    };
    
    Game_CharacterBase.prototype.getOffFromObject = function() {
        var obj = this.riddingObject();
        if (obj != null) {
            obj._ridderCharacterId = -1;
        }
        this._ridingCharacterId = -1;
    };
    
    /*
    var _Game_CharacterBase_posNt = Game_CharacterBase.prototype.posNt;
    Game_CharacterBase.prototype.posNt = function(x, y) {
        if (this.ridding()) {
            return false;
        }
        else {
            return _Game_CharacterBase_isMoving.apply(this, arguments);
        }
    };
    */

    
    var _Game_CharacterBase_isNormalPriority = Game_CharacterBase.prototype.isNormalPriority;
    Game_CharacterBase.prototype.isNormalPriority = function() {
        //
        //
        if (this.ridding()) {
            return false;
        }
        else {
            return _Game_CharacterBase_isNormalPriority.apply(this, arguments);
        }
    };

    var _Game_CharacterBase_isMoving = Game_CharacterBase.prototype.isMoving;
    Game_CharacterBase.prototype.isMoving = function() {
        if (this.ridding() && this._nowGetOnOrOff == 0) {
            // オブジェクトの上で静止している場合は停止状態とする。
            // ridding 時は下のオブジェクトと座標を同期するようになるため、
            // オリジナルの isMoving だは常に移動状態になってしまう。
            // こうしておくと、移動するオブジェクトから降りるときにスムーズに移動できる。
            return false;
        }
        else {
            return _Game_CharacterBase_isMoving.apply(this, arguments);
        }
    };
    
    var _Game_CharacterBase_updateStop = Game_CharacterBase.prototype.updateStop;
    Game_CharacterBase.prototype.updateStop = function() {
        _Game_CharacterBase_updateStop.apply(this, arguments);

        if (!this.ridding()) {
            this._ridingScreenZPriorityFlag = false;
        }

        this._nowGetOnOrOff = 0;
    };

    var _Game_CharacterBase_updateMove = Game_CharacterBase.prototype.updateMove;
    Game_CharacterBase.prototype.updateMove = function() {
        var oldMoving = this.isMoving();

        _Game_CharacterBase_updateMove.apply(this, arguments);

        if (this._nowGetOnOrOff != 0 && this.isMoving()) {
            this._getonFrameCount++;
            var tx = 0;
            var ty = 0;

            if (this._nowGetOnOrOff == 1) {
                // オブジェクトへ乗ろうとしているときは補完を実施して自然に移動しているように見せる
                var obj = this.riddingObject();
                tx = obj._realX;
                ty = obj._realY - (obj.objectHeight());
            }
            else if (this._nowGetOnOrOff == 2) {
                tx = this._x;
                ty = this._y;
            }

            var t = Math.min(this._getonFrameCount / this._getonFrameMax, 1.0);
            this._realX = MovingHelper.linear(t, this._getonStartX, tx - this._getonStartX, 1.0);
            this._realY = MovingHelper.linear(t, this._getonStartY, ty - this._getonStartY, 1.0);

            if (this._getonFrameCount >= this._getonFrameMax) {
                // 移動完了
                this._nowGetOnOrOff = 0;
            }
        }

        if (oldMoving != this.isMoving() && !this.isMoving()) {
            this.onStepEnd();
        }
    };
    
    var _Game_CharacterBase_updateJump = Game_CharacterBase.prototype.updateJump;
    Game_CharacterBase.prototype.updateJump = function() {
        var oldJumping = this.isJumping();

        _Game_CharacterBase_updateJump.apply(this, arguments);

        if (this.ridding() && oldJumping) {
            if (this._nowGetOnOrOff == 1) {
                // オブジェクトへ乗ろうとしているときは補完を実施して自然に移動しているように見せる
                
                var obj = this.riddingObject();
                var tx = obj._realX;
                var ty = obj._realY - (obj.objectHeight());
    
                var countMax = this._jumpPeak * 2;
                var t = Math.min((countMax - this._jumpCount + 1) / countMax, 1.0);
    
                this._realX = MovingHelper.linear(t, this._getonStartX, tx - this._getonStartX, 1.0);
                this._realY = MovingHelper.linear(t, this._getonStartY, ty - this._getonStartY, 1.0);
    
                // ここで論理座標も同期しておかないと、ジャンプ完了時の一瞬だけ画面が揺れる
                this._x = obj._x;
                this._y = obj._y - obj.objectHeight();
            }
        }
    }

    var _Game_CharacterBase_update = Game_CharacterBase.prototype.update;
    Game_CharacterBase.prototype.update = function() {
        if (this._movingBehavior) {
            if (this._movingBehavior.onOwnerUpdate(this)) {
                return;
            }
        }
        if (this._movingBehaviorOwnerCharacterId >= 0) {
            var character = MovingHelper.findCharacterById(this._movingBehaviorOwnerCharacterId);
            if (character._movingBehavior.onTargetUpdate(this)) {
                return;
            }
        }

        _Game_CharacterBase_update.apply(this, arguments);

        if (this.ridding() && this._nowGetOnOrOff == 0) {
            var obj = this.riddingObject();
            this._x = obj._x;
            this._y = obj._y - obj.objectHeight();
            this._realX = obj._realX;
            this._realY = obj._realY - (obj.objectHeight());
        }
    }
    
    // 1歩歩き終わり、次の移動ができる状態になった
    Game_CharacterBase.prototype.onStepEnd = function() {
        if (this._movingBehavior) {
            this._movingBehavior.onOwnerStepEnding(this);
        }
        if (this._movingBehaviorOwnerCharacterId >= 0) {
            var character = MovingHelper.findCharacterById(this._movingBehaviorOwnerCharacterId)
            character._movingBehavior.onTargetStepEnding(this);
        }
    }

    Game_CharacterBase.prototype.startMoveToObjectOrGround = function() {
        // 移動しているオブジェクトへなめらかに移動する対策
        
        this._getonFrameMax = (1.0 / this.distancePerFrame());
        this._getonFrameCount = 0;
        this._getonStartX = this._realX;
        this._getonStartY = this._realY;
    }

    Game_CharacterBase.prototype.startJumpToObject = function() {
        // 移動しているオブジェクトへなめらかに移動する対策
        
        this._getonStartX = this._realX;
        this._getonStartY = this._realY;
    }
    
    Game_CharacterBase.prototype.detachMovingBehavior = function() {
        this._movingBehavior = null;
    };
    
    //-----------------------------------------------------------------------------
    // Game_Player
    // 　

    Game_Player.prototype.gsObjectId = function() {
        return 0;
    };
    
    var _Game_Player_isCollided = Game_Player.prototype.isCollided;
    Game_Player.prototype.isCollided = function(x, y) {
        if (this.ridding()) {
            // オブジェクトに乗っているプレイヤーとは衝突判定しない
            return false;
        } else {
            _Game_Player_isCollided.apply(this, arguments);
        }
    };
    
    var _Game_Player_getInputDirection = Game_Player.prototype.getInputDirection;
    Game_Player.prototype.getInputDirection = function() {
        if (this.isControlledByMovingBehavior()) {
            return;
        }
        return _Game_Player_getInputDirection.apply(this, arguments);
    };

    //-----------------------------------------------------------------------------
    // Game_Event
    // 　
    
    var _Game_Event_initialize = Game_Event.prototype.initialize;
    Game_Event.prototype.initialize = function(mapId, eventId) {
        this._gsObjectHeight = -1;
        this._isMapObject = false;
        _Game_Event_initialize.apply(this, arguments);

        //this.parseNoteForGSObj(this.event().note);
    };

    Game_Event.prototype.isMapObject = function() {
        return this._isMapObject;
    };

    Game_Event.prototype.gsObjectId = function() {
        return this.eventId();
    };

    Game_Event.prototype.objectHeight = function() {
        return this._gsObjectHeight;
    };

    Game_Event.prototype.isCollidedWithEvents = function(x, y) {
        var events = $gameMap.eventsXyNt(x, y);
        // オブジェクトに乗っているイベントとは衝突判定しない
        return events.some(function(event) {
            return !event.ridding();
        });
    };
    
    var _Game_Event_setupPage = Game_Event.prototype.setupPage;
    Game_Event.prototype.setupPage = function() {
        _Game_Event_setupPage.apply(this, arguments);

        var index = this.event().note.indexOf("@MapObject");
        if (index >= 0) {
            this._isMapObject = true;
            this.parseListCommentForAMPSObject();
        }
    }

    Game_Event.prototype.parseListCommentForAMPSObject = function() {

        var list = this.list();
        if (list && list.length > 1) {

            // collect comments
            var comments = "";
            for (var i = 0; i < list.length; i++) {
                if (list[i].code == 108 || list[i].code == 408) {
                    comments += list[i].parameters[0];
                }
            }


            var index = comments.indexOf("@MapObject");
            if (index >= 0) {
                var block = comments.substring(index + 6);
                block = block.substring(
                    block.indexOf("{") + 1,
                    block.indexOf("}"));

                var nvps = block.split(",");
                for (var i = 0; i < nvps.length; i++) {
                    var tokens = nvps[i].split(":");
                    switch (tokens[0].trim())
                    {
                        case "h":
                        case "height":
                            this._gsObjectHeight = Number(tokens[1].trim()); 
                            break;
                    }
                }
            }
        }
    }

    Game_Event.prototype.parseNoteForGSObj = function(note) {
        var index = note.indexOf("@GSObj");
        if (index >= 0)
        {
            var block = note.substring(index + 6);
            block = block.substring(
                block.indexOf("{") + 1,
                block.indexOf("}"));

            var nvps = block.split(",");
            for (var i = 0; i < nvps.length; i++) {
                var tokens = block.split(":");
                switch (tokens[0])
                {
                    case "h":
                        this._gsObjectHeight = Number(tokens[1]); 
                        break;
                }
            }
        }
    };









    //=============================================================================


    //-----------------------------------------------------------------------------
    // MapSkillManager
    // 　

    function MapSkillManager() {
        this.initialize.apply(this, arguments);
    };

    MapSkillManager.prototype.initialize = function() {
    };

    MapSkillManager.prototype.reset = function() {
    };

    MapSkillManager.prototype.startControll = function(controllName, controller, controllee) {
        controller.startMovingBehavior(new MovingBehavior_MapSkillController_Move(controllee));
    };
    
    MapSkillManager.prototype.endControll = function() {
        
    };


    //-----------------------------------------------------------------------------
    // Game_Map
    // 　

    var _Game_Map_initialize = Game_Map.prototype.initialize;
    Game_Map.prototype.initialize = function() {
        _Game_Map_initialize.apply(this, arguments);
        this._mapSkillManager = new MapSkillManager();
    };

    var _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        _Game_Map_setup.apply(this, arguments);
        this._mapSkillManager.reset();
    };
    
    Game_Map.prototype.mapSkillManager = function() {
        return this._mapSkillManager;
    };

    //-----------------------------------------------------------------------------
    // MovingBehaviorBase
    // 　

    function MovingBehaviorBase() {
        this.initialize.apply(this, arguments);
    };

    MovingBehaviorBase.prototype.initialize = function() {
        this._ownerCharacterId = -1;
        this._targetCharacterId = -1;
    };

    MovingBehaviorBase.prototype.attachMovingBehavior = function(ownerCharacter, targetCharacter) {
        this._ownerCharacterId = ownerCharacter.gsObjectId();
        this._targetCharacterId = targetCharacter.gsObjectId();
        ownerCharacter._movingBehavior = this;
        targetCharacter._movingBehaviorOwnerCharacterId = this._ownerCharacterId;
    };
    
    MovingBehaviorBase.prototype.detach = function() {
        this.ownerCharacter()._movingBehavior = null;
        this.targetCharacter()._movingBehaviorOwnerCharacterId = -1;
        this._ownerCharacterId = -1;
        this._targetCharacterId = -1;
    }

    MovingBehaviorBase.prototype.ownerCharacter = function() {
        return MovingHelper.findCharacterById(this._ownerCharacterId);
    };

    MovingBehaviorBase.prototype.targetCharacter = function() {
        return MovingHelper.findCharacterById(this._targetCharacterId);
    };

    // true を返すと処理済み。元の更新処理を行わない
    MovingBehaviorBase.prototype.onOwnerUpdate = function(ownerCharacter) {
        return false;
    };

    // 1歩の更新が終わり、stop 状態に以降した瞬間。ここでまた移動すると、移動ルートなどが割り込まずに移動を継続できる。
    MovingBehaviorBase.prototype.onOwnerStepEnding = function(ownerCharacter) {
    };

    MovingBehaviorBase.prototype.onTargetUpdate = function(targetCharacter) {
        return false;
    };

    MovingBehaviorBase.prototype.onTargetStepEnding = function(targetCharacter) {
    };

    //-----------------------------------------------------------------------------
    // MovingBehavior_PushMoving
    // 　

    function MovingBehavior_PushMoving() {
        this.initialize.apply(this, arguments);
    };

    MovingBehavior_PushMoving.prototype = Object.create(MovingBehaviorBase.prototype);
    MovingBehavior_PushMoving.prototype.constructor = MovingBehavior_PushMoving;

    MovingBehavior_PushMoving.tryPushObjectAndMove = function(character, d) {
        var dx = Math.round(MovingHelper.roundXWithDirectionLong(character._x, d, 1));
        var dy = Math.round(MovingHelper.roundYWithDirectionLong(character._y, d, 1));

        var obj = MovingHelper.findObject(dx, dy, false);
        if (obj) {
            if (MovingBehavior_PushMoving.tryMoveAsPushableObject(obj, d)) {
                character.moveToDir(d, true);
                if (character._orignalMovingSpeed == 0) {
                    character._orignalMovingSpeed = character.moveSpeed();
                }
                character.setMoveSpeed(obj.moveSpeed());
                character._movingMode = Game_BattlerBase.MOVINGMODE_PUSHING;

                var b = new MovingBehavior_PushMoving();
                b.attachMovingBehavior(character, obj);
    
                character.setMovementSuccess(true);
                return true;
            }
        }
        
        return false;
    };

    MovingBehavior_PushMoving.tryMoveAsPushableObject = function(obj, d) {
        var dx = Math.round(MovingHelper.roundXWithDirectionLong(obj._x, d, 1));
        var dy = Math.round(MovingHelper.roundYWithDirectionLong(obj._y, d, 1));
        console.log(paramGuideLineTerrainTag);
        if ($gameMap.terrainTag(dx, dy) == paramGuideLineTerrainTag) {
            obj.moveStraight(d);
            if (obj.isMovementSucceeded()) {
                obj._movingMode = Game_BattlerBase.MOVINGMODE_PUSHED;
                return true;
            }
        }
        return false;
    };

    MovingBehavior_PushMoving.prototype.initialize = function() {
    };

    //MovingBehaviorBase.prototype.onOwnerUpdate = function(ownerCharacter) {
    //    return true;
    //};

    MovingBehaviorBase.prototype.onOwnerStepEnding = function(ownerCharacter) {
        ownerCharacter.setMoveSpeed(ownerCharacter._orignalMovingSpeed);
        ownerCharacter._orignalMovingSpeed = 0;
        ownerCharacter._movingMode = Game_BattlerBase.MOVINGMODE_DEFAULT;
    };

    MovingBehaviorBase.prototype.onTargetStepEnding = function(targetCharacter) {
        targetCharacter._movingMode = Game_BattlerBase.MOVINGMODE_DEFAULT;
        this.detach();
    };












    
    //-----------------------------------------------------------------------------
    // MovingBehavior_MapSkillController_Move
    // 　

    function MovingBehavior_MapSkillController_Move() {
        this.initialize.apply(this, arguments);
    };

    MovingBehavior_MapSkillController_Move.prototype = Object.create(MovingBehaviorBase.prototype);
    MovingBehavior_MapSkillController_Move.prototype.constructor = MovingBehavior_MapSkillController_Move;

    MovingBehavior_MapSkillController_Move.prototype.initialize = function(controllee) {
        this._controllee = controllee;
        this._state = "input";
    };

    MovingBehavior_MapSkillController_Move.prototype.onUpdate = function(ownerCharacter) {
        if (this._state == "input") {
            var d = Input.dir4;;
            if (d != 0) {
                this._controllee.moveStraight(d);
                if (this._controllee.isMovementSucceeded()) {
                    this._state = "prologue";
                }
            }
        }
        else if (this._state == "prologue") {
            if (this._controllee.isStopping()) {
                ownerCharacter.endMovingBehavior();
            }
        }
    };

    //-----------------------------------------------------------------------------
    // Game_Interpreter
    
    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.apply(this, arguments);
        if (command == "AMPS_SKILL_MOVE") {
            var controller = MovingHelper.findCharacterById(Number(args[0]));
            if (controller) {
                var controllee = MovingHelper.findObjectLineRange(controller, controller.direction(), 2);
                $gameMap.mapSkillManager().startControll("move", controller, controllee);
            }
        }
    };
        
})(this);
